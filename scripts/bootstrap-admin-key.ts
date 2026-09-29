import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ApiKeysService } from "../src/auth/api-keys.service";
import { PrismaService } from "../src/database/prisma.service";
import { ApiRole } from "../src/database/prisma";

/**
 * Casse l'œuf-poule de l'étape 5 : POST /v1/api-keys est réservé à ADMIN,
 * donc la toute première clé ADMIN ne peut pas venir de cette route — il
 * faut un accès direct au service, hors HTTP. Un script à lancer une fois
 * par environnement (dev, puis prod le jour venu), jamais par l'API.
 *
 * Idempotent par choix : si une clé ADMIN active existe déjà, on ne crée
 * rien — exécuter ce script deux fois par erreur ne doit pas faire
 * proliférer les clés admin.
 */
async function main(): Promise<void> {
  // Script one-shot : le vrai cron d'expiration (toutes les minutes)
  // n'a rien à faire ici et risquerait de percuter nos propres requêtes
  // (P2028) — voir app.module.ts.
  process.env.EXPIRATION_CRON_ENABLED = "false";

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const apiKeys = app.get(ApiKeysService);

  const existing = await prisma.client.apiKey.findFirst({
    where: { role: ApiRole.ADMIN, isActive: true },
  });
  if (existing) {
    console.log(`Une clé ADMIN active existe déjà (id ${existing.id}, "${existing.label}") — rien à faire.`);
    await app.close();
    return;
  }

  const { apiKey, rawKey } = await apiKeys.create({ label: "bootstrap admin", role: ApiRole.ADMIN });
  console.log(`Clé ADMIN créée (id ${apiKey.id}).`);
  console.log(`Clé en clair, à conserver maintenant — elle ne sera plus jamais affichée :\n${rawKey}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
