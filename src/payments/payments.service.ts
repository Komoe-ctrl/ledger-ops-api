import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma, withActor, Transaction, TransactionType } from "../database/prisma";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { fingerprintOf, generateTransactionReference } from "./payments.util";

export type CreatePaymentResult = {
  transaction: Transaction;
  /** true si aucune création n'a eu lieu : la clé d'idempotence a été rejouée avec un corps identique. */
  replayed: boolean;
};

/**
 * P2002 = violation de contrainte unique côté Prisma. Sous le driver adapter
 * (@prisma/adapter-pg), le nom de la contrainte Postgres n'est PAS dans
 * `error.meta.target` (le format historique Prisma) mais dans
 * `error.meta.driverAdapterError.cause.constraint.index` — vérifié
 * empiriquement, pas documenté nulle part au moment d'écrire ceci.
 */
function isUniqueViolationOn(error: unknown, indexNameHint: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as
    | { driverAdapterError?: { cause?: { constraint?: { index?: string } } } }
    | undefined;
  const index = meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof index === "string" && index.includes(indexNameHint);
}

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreatePaymentDto, idempotencyKey: string): Promise<CreatePaymentResult> {
    const fingerprint = fingerprintOf(dto);

    try {
      // On tente directement la création. Si deux requêtes concurrentes
      // portent la même clé, la contrainte unique "idempotency_key" de
      // Postgres n'en laisse passer qu'une : c'est elle l'arbitre, pas un
      // SELECT préalable (qui pourrait passer pour les deux requêtes à la
      // fois avant qu'aucune n'ait encore inséré — TOCTOU).
      // Acteur SYSTEM en attendant l'authentification (jalon 4, RBAC).
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
    } catch (error) {
      if (!isUniqueViolationOn(error, "idempotency_key")) {
        throw error;
      }
    }

    // On a perdu la course : quelqu'un d'autre a inséré cette clé entre
    // notre tentative et l'erreur ci-dessus. On relit ce qu'il/elle a créé.
    const existing = await this.prisma.client.transaction.findUniqueOrThrow({
      where: { idempotencyKey },
    });

    if (existing.requestFingerprint !== fingerprint) {
      throw new UnprocessableEntityException(
        "Idempotency-Key déjà utilisée avec un corps de requête différent",
      );
    }

    return { transaction: existing, replayed: true };
  }
}
