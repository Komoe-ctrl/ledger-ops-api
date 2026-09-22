import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";

export * from "../generated/prisma/client";
export { LedgerErrorCode, extractLedgerErrorCode, extractLedgerErrorMessage, isLedgerError } from "./ledger-errors";

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Qui agit. Obligatoire pour tout changement de statut (la base refuse sinon : LX007). */
export type Actor =
  | { type: "USER"; id: string; reason?: string }
  | { type: "SYSTEM"; id: string; reason?: string }
  | { type: "PROVIDER"; id: string; reason?: string };

export type WithActorOptions = {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
};

/**
 * Seule porte d'entrée pour une opération qui modifie de l'argent ou un statut.
 * Ouvre UNE transaction SQL, y déclare l'acteur (lu par les triggers
 * d'historique), puis exécute `fn`. Tout réussit ou tout est annulé.
 *
 * Isolation : READ COMMITTED + verrous explicites (SELECT ... FOR UPDATE)
 * par défaut. SERIALIZABLE est possible mais impose de rejouer sur 40001 ;
 * ce rejeu sera géré dans la couche service (jalon 2).
 */
export async function withActor<T>(
  prisma: PrismaClient,
  actor: Actor,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: WithActorOptions = {},
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // Paramètres liés (pas de concaténation) ; portée = cette transaction uniquement.
      await tx.$executeRaw`
        SELECT set_config('app.actor_type', ${actor.type}, true),
               set_config('app.actor_id',   ${actor.id}, true),
               set_config('app.reason',     ${actor.reason ?? ""}, true)`;
      return fn(tx);
    },
    {
      isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      timeout: options.timeoutMs ?? 10_000,
    },
  );
}
