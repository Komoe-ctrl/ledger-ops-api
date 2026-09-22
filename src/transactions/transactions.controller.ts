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
import type { Response } from "express";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { TransitionStatusDto } from "./dto/transition-status.dto";
import { TransactionsService } from "./transactions.service";
import { toHistoryResponse, toTransactionResponse } from "./transaction.presenter";

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

@Controller("v1/transactions")
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Get()
  async list(@Query() query: ListTransactionsQueryDto) {
    const { data, nextCursor } = await this.transactions.list(query);
    return { data: data.map(toTransactionResponse), nextCursor };
  }

  @Get(":reference")
  async getOne(@Param("reference") reference: string, @Res({ passthrough: true }) res: Response) {
    const transaction = await this.transactions.findByReferenceOrThrow(reference);
    res.setHeader("ETag", String(transaction.version));
    return toTransactionResponse(transaction);
  }

  @Get(":reference/history")
  async getHistory(@Param("reference") reference: string) {
    const history = await this.transactions.history(reference);
    return history.map(toHistoryResponse);
  }

  /**
   * Interne pour l'instant (pas de garde RBAC — jalon 4). Nécessite
   * `If-Match: <version>`, obtenue via l'en-tête ETag d'un GET précédent.
   */
  @Patch(":reference/status")
  async transition(
    @Param("reference") reference: string,
    @Body() dto: TransitionStatusDto,
    @Headers("if-match") ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expectedVersion = parseIfMatch(ifMatch);
    const transaction = await this.transactions.transition(reference, dto, expectedVersion);
    res.setHeader("ETag", String(transaction.version));
    return toTransactionResponse(transaction);
  }
}
