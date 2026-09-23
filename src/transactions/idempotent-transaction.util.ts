import { UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma, Transaction, withActor } from "../database/prisma";

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

export type IdempotentCreateResult = {
  transaction: Transaction;
  /** true si aucune création n'a eu lieu : la clé d'idempotence a été rejouée avec un corps identique. */
  replayed: boolean;
};

/**
 * Mécanisme d'idempotence partagé par tout ce qui insère dans `transactions`
 * (paiements, remboursements) : `idempotency_key` est unique sur toute la
 * table, tous types confondus. Insert-first, pas de SELECT préalable — voir
 * jalon 2, étape 7, pour le pourquoi (TOCTOU sous requêtes concurrentes).
 */
export async function createTransactionIdempotently(
  prisma: PrismaService,
  actorId: string,
  idempotencyKey: string,
  fingerprint: string,
  insert: (tx: Prisma.TransactionClient) => Promise<Transaction>,
): Promise<IdempotentCreateResult> {
  try {
    const transaction = await withActor(prisma.client, { type: "SYSTEM", id: actorId }, insert);
    return { transaction, replayed: false };
  } catch (error) {
    if (!isUniqueViolationOn(error, "idempotency_key")) {
      throw error;
    }
  }

  // On a perdu la course : quelqu'un d'autre a inséré cette clé entre notre
  // tentative et l'erreur ci-dessus. On relit ce qu'il/elle a créé.
  const existing = await prisma.client.transaction.findUniqueOrThrow({
    where: { idempotencyKey },
  });

  if (existing.requestFingerprint !== fingerprint) {
    throw new UnprocessableEntityException(
      "Idempotency-Key déjà utilisée avec un corps de requête différent",
    );
  }

  return { transaction: existing, replayed: true };
}
