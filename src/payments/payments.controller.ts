import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import type { Response } from "express";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";
import { PaymentsService } from "./payments.service";
import { requireIdempotencyKey } from "./payments.util";
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
    const key = requireIdempotencyKey(idempotencyKey);
    const { transaction, replayed } = await this.payments.create(dto, key);

    if (replayed) {
      res.setHeader("Idempotent-Replayed", "true");
      res.status(200);
    }

    return toTransactionResponse(transaction);
  }

  @Post(":reference/refunds")
  @HttpCode(201)
  @ApiOperation({
    summary: "Rembourser un paiement (partiel ou total)",
    description:
      "Crée une transaction REFUND au statut INITIATED, rattachée au paiement. Idempotent, comme " +
      "POST /v1/payments. L'écriture comptable (ADR 0005) est posée au passage PENDING -> SUCCEEDED du " +
      "remboursement, pas à sa création.",
  })
  @ApiParam({ name: "reference", example: "TXN-20260922-8F3K2Q", description: "Référence du paiement à rembourser." })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ description: "Remboursement créé.", type: TransactionResponseDto })
  @ApiOkResponse({
    description: "Rejeu idempotent.",
    type: TransactionResponseDto,
    headers: { "Idempotent-Replayed": { schema: { type: "string", example: "true" } } },
  })
  @ApiUnprocessableEntityResponse({ type: ProblemDetailsDto })
  async createRefund(
    @Param("reference") reference: string,
    @Body() dto: CreateRefundDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransactionResponseDto> {
    const key = requireIdempotencyKey(idempotencyKey);
    const { transaction, replayed } = await this.payments.createRefund(reference, dto, key);

    if (replayed) {
      res.setHeader("Idempotent-Replayed", "true");
      res.status(200);
    }

    return toTransactionResponse(transaction);
  }
}
