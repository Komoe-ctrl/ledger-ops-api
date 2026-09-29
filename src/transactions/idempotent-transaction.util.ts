import { UnprocessableEntityException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { Prisma, Transaction, withActor } from "../database/prisma";

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
 *
 * Sur ÉCHEC de l'insertion, on vérifie s'il existe déjà une ligne pour cette
 * clé — quelle que soit l'erreur remontée, pas seulement P2002 (violation
 * d'unicité, le cas courant sous concurrence) : un trigger `BEFORE INSERT`
 * qui valide une règle métier (ex. LX010, "reste remboursable" sur un
 * remboursement) s'exécute AVANT que Postgres ait la moindre chance de
 * détecter la vraie duplication sur `idempotency_key` (les contraintes
 * d'unicité ne sont vérifiées qu'après les triggers BEFORE ROW). Un rejeu
 * portant sur un remboursement déjà entièrement soldé percuterait donc LX010
 * avant même d'atteindre la détection habituelle — constaté en testant le
 * rejeu du seed de démo (jalon 5), pas seulement une hypothèse.
 *
 * Si aucune ligne n'existe pour cette clé, l'erreur d'origine remonte
 * telle quelle : ce n'était pas un rejeu, juste une vraie erreur (LX010
 * inclus, pour une tentative réellement invalide).
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
    const existing = await prisma.client.transaction.findUnique({ where: { idempotencyKey } });
    if (!existing) {
      throw error;
    }

    if (existing.requestFingerprint !== fingerprint) {
      throw new UnprocessableEntityException(
        "Idempotency-Key déjà utilisée avec un corps de requête différent",
      );
    }

    return { transaction: existing, replayed: true };
  }
}
