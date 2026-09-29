import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ApiKeysService } from "../src/auth/api-keys.service";
import { MerchantsService } from "../src/merchants/merchants.service";
import { PrismaService } from "../src/database/prisma.service";
import { ApiRole, Prisma } from "../src/database/prisma";
import { CreateMerchantDto } from "../src/merchants/dto/create-merchant.dto";

/**
 * Jeu de données de démonstration — jalon 5. Passe uniquement par les
 * services applicatifs (MerchantsService, ApiKeysService, puis PaymentsService/
 * TransactionsService/ReconciliationService dans les étapes suivantes),
 * jamais par un INSERT direct qui contournerait une règle métier : les
 * données produites doivent être indiscernables de vraies données par un
 * auditeur.
 *
 * Sûr à ré-exécuter sur une base déjà peuplée (pas seulement après le reset
 * nocturne) :
 * - marchands : identifiés par leur "code" unique, jamais recréés si déjà
 *   présents (voir getOrCreateMerchant).
 * - clés API de démo : identifiées par un label stable ("seed:demo:*"),
 *   révoquées puis réémises à chaque exécution — la valeur en clair affichée
 *   en fin de script est donc toujours valide, y compris sur un rejeu sans
 *   reset (au prix d'invalider la clé précédente, acceptable ici : c'est un
 *   jeu de démo, pas un secret de production).
 */

const DEMO_MERCHANTS: CreateMerchantDto[] = [
  { code: "boutique_akwaba", name: "Boutique Akwaba" },
  { code: "pharmacie_plateau", name: "Pharmacie du Plateau" },
  { code: "maquis_chez_tantie", name: "Maquis Chez Tantie" },
];

/** Le marchand auquel la clé MERCHANT de démo est bornée (ApiKey.merchantId, un seul FK). */
const MERCHANT_KEY_MERCHANT_CODE = "boutique_akwaba";

const SEED_MERCHANT_KEY_LABEL = "seed:demo:merchant";
const SEED_ANALYST_KEY_LABEL = "seed:demo:analyst";

async function getOrCreateMerchant(merchants: MerchantsService, dto: CreateMerchantDto) {
  try {
    return await merchants.create(dto);
  } catch (err) {
    // P2002 = violation de contrainte unique (code déjà pris) : pas une
    // vraie erreur ici, juste la preuve qu'un run précédent l'a déjà créé.
    // MerchantsService.create() reste strict pour tout AUTRE appelant (un
    // admin qui tape un code en double par erreur doit voir un 409, pas un
    // succès silencieux) — ce repli est délibérément local à ce script.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return merchants.findByCodeOrThrow(dto.code);
    }
    throw err;
  }
}

/**
 * Révoque toute clé active portant ce label puis en émet une nouvelle.
 * Jamais de clé "orpheline" en doublon après plusieurs exécutions : à tout
 * instant, au plus une clé active par label de démo.
 */
async function reissueApiKey(
  prisma: PrismaService,
  apiKeys: ApiKeysService,
  label: string,
  role: ApiRole,
  merchantId?: string,
) {
  const existing = await prisma.client.apiKey.findMany({ where: { label, isActive: true } });
  for (const key of existing) {
    await apiKeys.revoke(key.id);
  }
  return apiKeys.create({ label, role, merchantId });
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const merchants = app.get(MerchantsService);
  const apiKeys = app.get(ApiKeysService);

  console.log("--- Marchands ---");
  const createdMerchants = new Map<string, Awaited<ReturnType<typeof getOrCreateMerchant>>>();
  for (const dto of DEMO_MERCHANTS) {
    const merchant = await getOrCreateMerchant(merchants, dto);
    createdMerchants.set(merchant.code, merchant);
    console.log(`  ${merchant.code} (${merchant.id})`);
  }

  const merchantKeyTarget = createdMerchants.get(MERCHANT_KEY_MERCHANT_CODE);
  if (!merchantKeyTarget) {
    throw new Error(`Marchand ${MERCHANT_KEY_MERCHANT_CODE} introuvable après création — incohérence dans DEMO_MERCHANTS`);
  }

  console.log("--- Clés API de démo (révoquées puis réémises) ---");
  const merchantKey = await reissueApiKey(prisma, apiKeys, SEED_MERCHANT_KEY_LABEL, ApiRole.MERCHANT, merchantKeyTarget.id);
  const analystKey = await reissueApiKey(prisma, apiKeys, SEED_ANALYST_KEY_LABEL, ApiRole.ANALYST);

  console.log("");
  console.log("Clés en clair — à coller dans le README de démo, non récupérables ensuite :");
  console.log(`  MERCHANT (${MERCHANT_KEY_MERCHANT_CODE}) : ${merchantKey.rawKey}`);
  console.log(`  ANALYST                    : ${analystKey.rawKey}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
