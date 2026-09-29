import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../../src/app.module";
import { configureApp } from "../../../src/app.config";
import { Clock } from "../../../src/common/clock";
import { ApiKeysService } from "../../../src/auth/api-keys.service";
import { MerchantsService } from "../../../src/merchants/merchants.service";
import { ApiRole } from "../../../src/database/prisma";

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

export type TestApiKeys = {
  merchant: string;
  operator: string;
  analyst: string;
  admin: string;
};

/**
 * "demo" existe dans toute base fraîche (seedé par la migration merchants) —
 * pas besoin de le créer ici, juste de récupérer son id pour la clé MERCHANT.
 */
export async function seedTestApiKeys(app: INestApplication): Promise<TestApiKeys> {
  const apiKeys = app.get(ApiKeysService);
  const merchants = app.get(MerchantsService);
  const demo = await merchants.findByCodeOrThrow("demo");

  const [merchant, operator, analyst, admin] = await Promise.all([
    apiKeys.create({ label: "e2e merchant", role: ApiRole.MERCHANT, merchantId: demo.id }),
    apiKeys.create({ label: "e2e operator", role: ApiRole.OPERATOR }),
    apiKeys.create({ label: "e2e analyst", role: ApiRole.ANALYST }),
    apiKeys.create({ label: "e2e admin", role: ApiRole.ADMIN }),
  ]);

  return {
    merchant: merchant.rawKey,
    operator: operator.rawKey,
    analyst: analyst.rawKey,
    admin: admin.rawKey,
  };
}

export function authHeader(rawKey: string): [string, string] {
  return ["Authorization", `Bearer ${rawKey}`];
}
