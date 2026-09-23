import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPreconditionFailedResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { TransitionStatusDto } from "./dto/transition-status.dto";
import { TransactionsService } from "./transactions.service";
import { toHistoryResponse, toTransactionResponse } from "./transaction.presenter";
import { TransactionResponseDto } from "./dto/transaction-response.dto";
import { TransactionListResponseDto } from "./dto/transaction-list-response.dto";
import { TransactionHistoryEntryDto } from "./dto/transaction-history-entry.dto";
import { ProblemDetailsDto } from "../common/dto/problem-details.dto";

function parseIfMatch(ifMatch: string | undefined): number {
  if (!ifMatch) {
    throw new BadRequestException("En-tête If-Match obligatoire");
  }
  const version = Number(ifMatch);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException("If-Match doit être un entier de version valide");
  }
  return version;
}

@ApiTags("transactions")
@Controller("v1/transactions")
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: "Lister les transactions (filtres + pagination par curseur)" })
  @ApiOkResponse({ type: TransactionListResponseDto })
  async list(@Query() query: ListTransactionsQueryDto): Promise<TransactionListResponseDto> {
    const { data, nextCursor } = await this.transactions.list(query);
    return { data: data.map(toTransactionResponse), nextCursor };
  }

  @Get(":reference")
  @ApiOperation({ summary: "Lire une transaction par sa référence" })
  @ApiParam({ name: "reference", example: "TXN-20260922-8F3K2Q" })
  @ApiOkResponse({
    type: TransactionResponseDto,
    headers: { ETag: { schema: { type: "string", example: "3" }, description: "= version. À rejouer en If-Match pour une transition." } },
  })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async getOne(
    @Param("reference") reference: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    const transaction = await this.transactions.findByReferenceOrThrow(reference);
    res.setHeader("ETag", String(transaction.version));
    return toTransactionResponse(transaction);
  }

  @Get(":reference/history")
  @ApiOperation({ summary: "Historique des statuts d'une transaction, du plus ancien au plus récent" })
  @ApiParam({ name: "reference", example: "TXN-20260922-8F3K2Q" })
  @ApiOkResponse({ type: [TransactionHistoryEntryDto] })
  @ApiNotFoundResponse({ type: ProblemDetailsDto })
  async getHistory(@Param("reference") reference: string): Promise<TransactionHistoryEntryDto[]> {
    const history = await this.transactions.history(reference);
    return history.map(toHistoryResponse);
  }

  @Patch(":reference/status")
  @ApiOperation({
    summary: "Transition de statut (interne)",
    description:
      "Pas encore de garde RBAC (jalon 4). Nécessite If-Match: <version>, obtenue via l'en-tête ETag " +
      "d'un GET précédent.",
  })
  @ApiParam({ name: "reference", example: "TXN-20260922-8F3K2Q" })
  @ApiHeader({ name: "If-Match", required: true, description: "Version attendue de la transaction." })
  @ApiOkResponse({
    type: TransactionResponseDto,
    headers: { ETag: { schema: { type: "string", example: "4" }, description: "Nouvelle version après transition." } },
  })
  @ApiPreconditionFailedResponse({ description: "If-Match périmé.", type: ProblemDetailsDto })
  async transition(
    @Param("reference") reference: string,
    @Body() dto: TransitionStatusDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    const expectedVersion = parseIfMatch(ifMatch);
    const transaction = await this.transactions.transition(reference, dto, expectedVersion);
    res.setHeader("ETag", String(transaction.version));
    return toTransactionResponse(transaction);
  }
}
