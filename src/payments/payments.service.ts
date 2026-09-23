import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TransactionType } from "../database/prisma";
import { createTransactionIdempotently, IdempotentCreateResult } from "../transactions/idempotent-transaction.util";
import { TransactionsService } from "../transactions/transactions.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";
import { computeExpiresAt, fingerprintOf, generateTransactionReference, refundFingerprintOf } from "./payments.util";

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
  ) {}

  async create(dto: CreatePaymentDto, idempotencyKey: string): Promise<IdempotentCreateResult> {
    const fingerprint = fingerprintOf(dto);

    return createTransactionIdempotently(this.prisma, "api:payments", idempotencyKey, fingerprint, (tx) =>
      tx.transaction.create({
        data: {
          reference: generateTransactionReference(),
          type: TransactionType.PAYMENT,
          provider: dto.provider,
          amount: BigInt(dto.amount),
          currency: dto.currency,
          customerMsisdn: dto.customerMsisdn,
          expiresAt: computeExpiresAt(),
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
      }),
    );
  }

  /**
   * Le parent est résolu (et vérifié exister — 404 sinon) au niveau
   * applicatif. Les règles plus fines (statut remboursable, montant <=
   * reste remboursable — LX010) restent la responsabilité de la base :
   * ADR 0003, dernière ligne de défense.
   */
  async createRefund(
    parentReference: string,
    dto: CreateRefundDto,
    idempotencyKey: string,
  ): Promise<IdempotentCreateResult> {
    const parent = await this.transactions.findByReferenceOrThrow(parentReference);
    const fingerprint = refundFingerprintOf(parentReference, dto);

    return createTransactionIdempotently(this.prisma, "api:payments", idempotencyKey, fingerprint, (tx) =>
      tx.transaction.create({
        data: {
          reference: generateTransactionReference(),
          type: TransactionType.REFUND,
          provider: parent.provider,
          amount: BigInt(dto.amount),
          currency: parent.currency,
          customerMsisdn: parent.customerMsisdn,
          parentTransactionId: parent.id,
          expiresAt: computeExpiresAt(),
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
      }),
    );
  }
}
