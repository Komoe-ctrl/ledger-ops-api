import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";
import { configureApp } from "../../../src/app.config";
import { Clock } from "../../../src/common/clock";

/**
 * Horloge substituable en test : `expires_at` étant figé après création
 * (migration freeze_expires_at), il est devenu impossible de simuler "le
 * temps a passé" en mutant une transaction existante — il faut créer une
 * transaction déjà échue, ce qui veut dire contrôler ce que le service
 * croit être "maintenant" au moment où il calcule l'échéance.
 */
export class ControllableClock extends Clock {
  private current = new Date();

  now(): Date {
    return this.current;
  }

  setNow(date: Date): void {
    this.current = date;
  }
}

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
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Clock)
    .useValue(new ControllableClock())
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  await app.listen(0);
  return app;
}

export function uniqueIdempotencyKey(label: string): string {
  return `e2e-${label}-${crypto.randomUUID()}`;
}
