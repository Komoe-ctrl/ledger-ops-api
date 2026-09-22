import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { withActor, Transaction, TransactionType } from "../database/prisma";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { fingerprintOf, generateTransactionReference } from "./payments.util";

export type CreatePaymentResult = {
  transaction: Transaction;
  /** true si aucune création n'a eu lieu : la clé d'idempotence a été rejouée avec un corps identique. */
  replayed: boolean;
};

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreatePaymentDto, idempotencyKey: string): Promise<CreatePaymentResult> {
    const fingerprint = fingerprintOf(dto);

    // Pas encore protégé contre la course entre deux requêtes concurrentes
    // portant la même clé : ce sera l'étape 7 (contrainte unique + rattrapage
    // du conflit, au lieu de ce SELECT préalable).
    const existing = await this.prisma.client.transaction.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new UnprocessableEntityException(
          "Idempotency-Key déjà utilisée avec un corps de requête différent",
        );
      }
      return { transaction: existing, replayed: true };
    }

    // Acteur SYSTEM en attendant l'authentification (jalon 4, RBAC) :
    // il n'existe pas encore d'identité appelante côté API.
    const transaction = await withActor(this.prisma.client, { type: "SYSTEM", id: "api:payments" }, (tx) =>
      tx.transaction.create({
        data: {
          reference: generateTransactionReference(),
          type: TransactionType.PAYMENT,
          provider: dto.provider,
          amount: BigInt(dto.amount),
          currency: dto.currency,
          customerMsisdn: dto.customerMsisdn,
          idempotencyKey,
          requestFingerprint: fingerprint,
        },
      }),
    );

    return { transaction, replayed: false };
  }
}
