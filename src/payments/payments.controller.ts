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
import type { Response } from "express";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { PaymentsService } from "./payments.service";
import { toPaymentResponse } from "./payments.util";

const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

@Controller("v1/payments")
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreatePaymentDto,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
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

    return toPaymentResponse(transaction);
  }
}
