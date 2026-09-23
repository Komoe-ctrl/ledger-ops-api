import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";
import { configureApp } from "../../../src/app.config";

/**
 * Même config que main.ts (voir src/app.config.ts) — pas un sous-ensemble.
 *
 * `app.listen(0)` plutôt que de laisser supertest driver un serveur jamais
 * mis en écoute : appelé une fois par requête sur un serveur "à froid",
 * supertest lui attache son propre listener 'listening' à chaque fois sans
 * le retirer, et Node finit par avertir d'une fuite (MaxListenersExceeded)
 * dès qu'on dépasse une poignée de requêtes dans la suite.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  await app.listen(0);
  return app;
}

export function uniqueIdempotencyKey(label: string): string {
  return `e2e-${label}-${crypto.randomUUID()}`;
}
