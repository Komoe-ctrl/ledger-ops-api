import { execSync } from "node:child_process";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

declare global {
  // eslint-disable-next-line no-var
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Un conteneur Postgres jetable pour toute la suite e2e — jamais la base
 * de dev. Les tables comptables sont en ajout seul (LX001) : impossible de
 * les vider entre deux runs de tests sur une base partagée sans un vrai
 * `migrate reset` (voir jalon 2, étape 4). Un conteneur neuf à chaque run
 * élimine le problème plutôt que de le contourner.
 */
export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = container.getConnectionUri();

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });

  // Le rôle "ledger_app" (privilèges minimaux) n'existe qu'APRÈS que les
  // migrations l'ont créé (migration least_privilege_app_role, ADR 0003) —
  // c'est pour ça qu'on ne peut construire cette URL qu'ici, pas avant. Même
  // hôte/port/base que le conteneur superutilisateur, juste un rôle différent.
  const appUrl = new URL(databaseUrl);
  appUrl.username = "ledger_app";
  appUrl.password = "ledger_app_dev_only";

  // Hérités par les workers Jest (processus enfants lancés après ce setup).
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_DATABASE_URL = appUrl.toString();
  globalThis.__PG_CONTAINER__ = container;
}
