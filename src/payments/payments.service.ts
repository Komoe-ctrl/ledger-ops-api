import { Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Clock } from "../common/clock";
import { PrismaService } from "../database/prisma.service";
import { TransactionType } from "../database/prisma";
import { OperatorSimulatorProducer } from "../provider-simulator/provider-simulator.producer";
import { createTransactionIdempotently, IdempotentCreateResult } from "../transactions/idempotent-transaction.util";
import { TransactionsService } from "../transactions/transactions.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";
import {
  computeExpiresAt,
  fingerprintOf,
  generateTransactionReference,
  refundFingerprintOf,
  resolveExpiryMinutes,
} from "./payments.util";

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(Clock) private readonly clock: Clock,
    // Undefined quand ProviderSimulatorModule n'est pas chargé (drapeau
    // désactivé — voir ConditionalModule dans app.module.ts). @Optional()
    // évite à PaymentsService de dépendre en dur d'un module absent.
    @Optional() @Inject(OperatorSimulatorProducer) private readonly simulator?: OperatorSimulatorProducer,
  ) {}

  /**
   * `merchantId` : pour quel marchand ce paiement encaisse — jamais choisi
   * par l'appelant (le corps de requête n'a pas ce champ). En attendant
   * l'authentification (étape 4), le contrôleur le résout provisoirement
   * sur le marchand "demo" ; ce service, lui, n'a plus le droit de deviner.
   */
  async create(dto: CreatePaymentDto, idempotencyKey: string, merchantId: string): Promise<IdempotentCreateResult> {
    const fingerprint = fingerprintOf(dto);
    const minutes = resolveExpiryMinutes(this.config, dto.provider);

    const result = await createTransactionIdempotently(this.prisma, "api:payments", idempotencyKey, fingerprint, (tx) =>
      tx.transaction.create({
        data: {
          reference: generateTransactionReference(),
          type: TransactionType.PAYMENT,
          provider: dto.provider,
          amount: BigInt(dto.amount),
          currency: dto.currency,
          customerMsisdn: dto.customerMsisdn,
          merchantId,
          expiresAt: computeExpiresAt(this.clock.now(), minutes),
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
      }),
    );

    // Rejeu : rien de nouveau n'a été créé, rien à simuler une deuxième fois.
    if (!result.replayed) {
      await this.simulator?.scheduleCallbacks(result.transaction.reference);
    }

    return result;
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
    merchantId: string,
  ): Promise<IdempotentCreateResult> {
    const parent = await this.transactions.findByReferenceOrThrow(parentReference);
    // Un marchand ne peut rembourser que ses propres paiements — jamais
    // dérivé de la clé API pour un autre marchand, même si la référence
    // existe (sinon un marchand pourrait sonder l'existence de transactions
    // d'un concurrent en essayant des références au hasard).
    if (parent.merchantId !== merchantId) {
      throw new NotFoundException(`Transaction ${parentReference} introuvable`);
    }
    const fingerprint = refundFingerprintOf(parentReference, dto);
    const minutes = resolveExpiryMinutes(this.config, parent.provider);

    const result = await createTransactionIdempotently(this.prisma, "api:payments", idempotencyKey, fingerprint, (tx) =>
      tx.transaction.create({
        data: {
          reference: generateTransactionReference(),
          type: TransactionType.REFUND,
          provider: parent.provider,
          amount: BigInt(dto.amount),
          currency: parent.currency,
          customerMsisdn: parent.customerMsisdn,
          parentTransactionId: parent.id,
          // Jamais choisi par l'appelant : un remboursement est dû par le
          // même marchand que le paiement d'origine, point final.
          merchantId: parent.merchantId,
          expiresAt: computeExpiresAt(this.clock.now(), minutes),
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
      }),
    );

    if (!result.replayed) {
      await this.simulator?.scheduleCallbacks(result.transaction.reference);
    }

    return result;
  }
}
