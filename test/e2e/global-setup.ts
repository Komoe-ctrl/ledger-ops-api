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

  // Hérité par les workers Jest (processus enfants lancés après ce setup).
  process.env.DATABASE_URL = databaseUrl;
  globalThis.__PG_CONTAINER__ = container;
}
