import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from "@nestjs/swagger";
import type { Response } from "express";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { PaymentsService } from "./payments.service";
import { toTransactionResponse } from "../transactions/transaction.presenter";
import { TransactionResponseDto } from "../transactions/dto/transaction-response.dto";
import { ProblemDetailsDto } from "../common/dto/problem-details.dto";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

@ApiTags("payments")
@Controller("v1/payments")
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Initier un paiement",
    description:
      "Crée une transaction PAYMENT au statut INITIATED. Idempotent : même clé + même corps renvoie la " +
      "transaction existante sans rien recréer (200, en-tête Idempotent-Replayed: true).",
  })
  @ApiHeader({ name: "Idempotency-Key", required: true, description: "Clé fournie par l'appelant, max 100 caractères." })
  @ApiCreatedResponse({ description: "Transaction créée.", type: TransactionResponseDto })
  @ApiOkResponse({
    description: "Rejeu idempotent : transaction existante renvoyée telle quelle, rien de créé.",
    type: TransactionResponseDto,
    headers: { "Idempotent-Replayed": { schema: { type: "string", example: "true" } } },
  })
  @ApiUnprocessableEntityResponse({
    description: "Idempotency-Key déjà utilisée avec un corps de requête différent.",
    type: ProblemDetailsDto,
  })
  async create(
    @Body() dto: CreatePaymentDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    if (!idempotencyKey || idempotencyKey.length === 0) {
      throw new BadRequestException("En-tête Idempotency-Key obligatoire");
    }
    if (idempotencyKey.length > 100) {
      throw new BadRequestException("Idempotency-Key trop longue (100 caractères max)");
    }

    const { transaction, replayed } = await this.payments.create(dto, idempotencyKey);

    if (replayed) {
      res.setHeader("Idempotent-Replayed", "true");
      res.status(200);
    }

    return toTransactionResponse(transaction);
  }
}
