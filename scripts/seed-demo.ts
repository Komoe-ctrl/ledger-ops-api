import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { ApiKeysService } from "../src/auth/api-keys.service";
import { MerchantsService } from "../src/merchants/merchants.service";
import { PaymentsService } from "../src/payments/payments.service";
import { TransactionsService } from "../src/transactions/transactions.service";
import { PrismaService } from "../src/database/prisma.service";
import { ApiRole, Merchant, Prisma, Provider, TransactionStatus } from "../src/database/prisma";
import { CreateMerchantDto } from "../src/merchants/dto/create-merchant.dto";
import { CreatePaymentDto } from "../src/payments/dto/create-payment.dto";

/**
 * Jeu de données de démonstration — jalon 5. Passe uniquement par les
 * services applicatifs (MerchantsService, ApiKeysService, PaymentsService,
 * TransactionsService, puis ReconciliationService dans les étapes
 * suivantes), jamais par un INSERT direct qui contournerait une règle
 * métier : les données produites doivent être indiscernables de vraies
 * données par un auditeur.
 *
 * Sûr à ré-exécuter sur une base déjà peuplée (pas seulement après le reset
 * nocturne) :
 * - marchands : identifiés par leur "code" unique, jamais recréés si déjà
 *   présents (voir getOrCreateMerchant).
 * - clés API de démo : identifiées par un label stable ("seed:demo:*"),
 *   révoquées puis réémises à chaque exécution.
 * - transactions : idempotency-key déterministe par scénario
 *   ("seed-demo-payment-0001"...) — un rejeu retrouve la même transaction
 *   sans en recréer une autre, et les transitions déjà jouées ne sont pas
 *   rejouées (voir replayed dans seedOnePayment).
 *
 * created_at reste TOUJOURS l'heure réelle d'exécution (imposé par la base,
 * jamais contournable depuis l'app — voir ADR 0003) : ce script ne fabrique
 * pas une fausse journée d'activité passée, il produit une activité réelle
 * et récente, indiscernable d'un usage réel au moment où il tourne.
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

// ---------------------------------------------------------------------------
// Étape 1 : marchands + clés API de démo
// ---------------------------------------------------------------------------

async function getOrCreateMerchant(merchants: MerchantsService, dto: CreateMerchantDto): Promise<Merchant> {
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

async function seedMerchantsAndKeys(
  prisma: PrismaService,
  merchants: MerchantsService,
  apiKeys: ApiKeysService,
): Promise<Map<string, Merchant>> {
  console.log("--- Marchands ---");
  const createdMerchants = new Map<string, Merchant>();
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

  return createdMerchants;
}

// ---------------------------------------------------------------------------
// Étape 2 : transactions (paiements)
// ---------------------------------------------------------------------------

type ScenarioOutcome = "SUCCEEDED" | "FAILED" | "EXPIRED" | "PENDING";

type TransactionScenario = {
  index: number;
  merchantCode: string;
  provider: Provider;
  outcome: ScenarioOutcome;
};

export type SeededTransaction = {
  reference: string;
  status: TransactionStatus;
  merchantCode: string;
};

const PROVIDERS: Provider[] = [Provider.ORANGE_MONEY, Provider.MTN_MOMO, Provider.WAVE, Provider.MOOV_MONEY];

/** "~60 à 80" transactions, majorité SUCCEEDED, quelques FAILED/EXPIRED, 2-3 PENDING en cours. */
const OUTCOME_COUNTS: Record<ScenarioOutcome, number> = {
  SUCCEEDED: 58,
  FAILED: 6,
  EXPIRED: 4,
  PENDING: 3,
};

const FAILURE_REASONS = [
  "Solde insuffisant côté client",
  "Timeout opérateur",
  "Annulé par le client",
  "PIN erroné (3 tentatives)",
];

function buildScenarios(): TransactionScenario[] {
  const merchantCodes = DEMO_MERCHANTS.map((m) => m.code);
  const scenarios: TransactionScenario[] = [];
  let index = 0;
  for (const outcome of Object.keys(OUTCOME_COUNTS) as ScenarioOutcome[]) {
    for (let i = 0; i < OUTCOME_COUNTS[outcome]; i++) {
      scenarios.push({
        index,
        merchantCode: merchantCodes[index % merchantCodes.length],
        provider: PROVIDERS[index % PROVIDERS.length],
        outcome,
      });
      index++;
    }
  }
  return scenarios;
}

/** Déterministe : un rejeu du script doit produire EXACTEMENT le même corps pour la même idempotency-key. */
function amountForIndex(index: number): string {
  const spread = 500 + ((index * 4173) % 49500);
  return String(Math.round(spread / 100) * 100);
}

function msisdnForIndex(index: number): string {
  return `+2250700${String(index).padStart(6, "0")}`;
}

function idempotencyKeyForIndex(index: number): string {
  return `seed-demo-payment-${String(index).padStart(4, "0")}`;
}

function providerReferenceForIndex(index: number): string {
  return `SEED-OK-${String(index).padStart(4, "0")}`;
}

async function seedOnePayment(
  payments: PaymentsService,
  transactions: TransactionsService,
  merchant: Merchant,
  scenario: TransactionScenario,
): Promise<SeededTransaction> {
  const dto: CreatePaymentDto = {
    provider: scenario.provider,
    amount: amountForIndex(scenario.index),
    currency: "XOF",
    customerMsisdn: msisdnForIndex(scenario.index),
  };
  const idempotencyKey = idempotencyKeyForIndex(scenario.index);
  const { transaction, replayed } = await payments.create(dto, idempotencyKey, merchant.id);

  if (replayed) {
    // Déjà entièrement traitée par une exécution précédente : la transaction
    // a déjà atteint son statut cible, ne rejoue pas les transitions
    // (SUCCEEDED -> PENDING serait de toute façon une transition interdite, LX005).
    return { reference: transaction.reference, status: transaction.status, merchantCode: scenario.merchantCode };
  }

  // Chemin commun à tous les scénarios : un push USSD part toujours, que le
  // client réponde ou non.
  let current = await transactions.transition(
    transaction.reference,
    { status: TransactionStatus.PENDING, reason: "Push USSD envoyé" },
    transaction.version,
  );

  if (scenario.outcome === "PENDING" || scenario.outcome === "EXPIRED") {
    // EXPIRED : laissé PENDING ici à dessein — la bascule se fait par lot,
    // après coup, via le vrai balayage (seedExpiredBatch), jamais par une
    // transition directe (EXPIRED n'est atteignable que par le sweep, voir
    // ADR 0007 et transaction_status_transitions).
    return { reference: current.reference, status: current.status, merchantCode: scenario.merchantCode };
  }

  if (scenario.outcome === "SUCCEEDED") {
    current = await transactions.transition(
      current.reference,
      {
        status: TransactionStatus.SUCCEEDED,
        providerReference: providerReferenceForIndex(scenario.index),
        reason: "Confirmation opérateur",
      },
      current.version,
    );
    return { reference: current.reference, status: current.status, merchantCode: scenario.merchantCode };
  }

  // FAILED
  current = await transactions.transition(
    current.reference,
    { status: TransactionStatus.FAILED, reason: FAILURE_REASONS[scenario.index % FAILURE_REASONS.length] },
    current.version,
  );
  return { reference: current.reference, status: current.status, merchantCode: scenario.merchantCode };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const EXPIRY_ENV_KEYS = [
  "PAYMENT_EXPIRY_MINUTES_DEFAULT",
  "PAYMENT_EXPIRY_MINUTES_ORANGE_MONEY",
  "PAYMENT_EXPIRY_MINUTES_MTN_MOMO",
  "PAYMENT_EXPIRY_MINUTES_WAVE",
  "PAYMENT_EXPIRY_MINUTES_MOOV_MONEY",
] as const;

/**
 * Substitue temporairement le délai d'expiration — le mécanisme RÉEL de
 * configuration par variable d'environnement (jalon 3), jamais une horloge
 * factice. Toutes les variables (défaut + les 4 par opérateur) sont
 * couvertes, pour ne pas dépendre de ce qu'un .env local aurait déjà fixé.
 * `ConfigService.get()` relit `process.env` à chaque appel (vérifié
 * empiriquement) : la mutation prend effet immédiatement, sans redémarrer
 * le contexte Nest.
 */
async function withShortExpiry<T>(minutes: string, fn: () => Promise<T>): Promise<T> {
  const previous = new Map(EXPIRY_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of EXPIRY_ENV_KEYS) process.env[k] = minutes;
    return await fn();
  } finally {
    for (const k of EXPIRY_ENV_KEYS) {
      const v = previous.get(k);
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function seedTransactions(
  payments: PaymentsService,
  transactions: TransactionsService,
  merchants: Map<string, Merchant>,
): Promise<SeededTransaction[]> {
  const scenarios = buildScenarios();
  const results: SeededTransaction[] = [];

  console.log("--- Transactions ---");

  // Tout sauf EXPIRED, sous le délai d'expiration normal : les "PENDING en
  // cours" doivent survivre plusieurs heures, jusqu'au reset nocturne.
  for (const scenario of scenarios.filter((s) => s.outcome !== "EXPIRED")) {
    const merchant = merchants.get(scenario.merchantCode);
    if (!merchant) throw new Error(`Marchand ${scenario.merchantCode} introuvable`);
    results.push(await seedOnePayment(payments, transactions, merchant, scenario));
  }

  // EXPIRED, sous un délai très court : crée + passe PENDING, attend
  // réellement que ce délai soit dépassé, puis déclenche le VRAI balayage
  // (TransactionsService.expireOverduePending) — chemin de production exact,
  // aucune horloge factice (voir discussion avant ce chantier).
  const expiredScenarios = scenarios.filter((s) => s.outcome === "EXPIRED");
  const expiredResults: SeededTransaction[] = [];
  await withShortExpiry("0.03" /* ~1.8 s */, async () => {
    for (const scenario of expiredScenarios) {
      const merchant = merchants.get(scenario.merchantCode);
      if (!merchant) throw new Error(`Marchand ${scenario.merchantCode} introuvable`);
      expiredResults.push(await seedOnePayment(payments, transactions, merchant, scenario));
    }
    await sleep(3000);
    const expiredCount = await transactions.expireOverduePending();
    console.log(`  balayage d'expiration : ${expiredCount} transaction(s) passée(s) EXPIRED`);
  });
  // Statut relu APRÈS le balayage : au moment de leur création, ces
  // transactions étaient encore PENDING — la mise à jour EXPIRED n'a lieu
  // que dans expireOverduePending(), pas dans seedOnePayment().
  for (const result of expiredResults) {
    const fresh = await transactions.findByReferenceOrThrow(result.reference);
    results.push({ ...result, status: fresh.status });
  }

  const counts = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  ${results.length} transactions au total :`, counts);

  return results;
}

// ---------------------------------------------------------------------------
// Étape 3 : remboursements (partiel + total) et litige perdu
// ---------------------------------------------------------------------------

/**
 * Amène une transaction jusqu'à SUCCEEDED, en reprenant depuis son statut
 * actuel — jamais en rejouant une transition déjà faite (SUCCEEDED ->
 * PENDING serait interdite, LX005). Couvre à la fois le premier passage et
 * une reprise après un rejeu du script.
 */
async function driveToSucceeded(transactions: TransactionsService, reference: string): Promise<void> {
  let current = await transactions.findByReferenceOrThrow(reference);
  if (current.status === TransactionStatus.INITIATED) {
    current = await transactions.transition(
      reference,
      { status: TransactionStatus.PENDING, reason: "Traitement du remboursement" },
      current.version,
    );
  }
  if (current.status === TransactionStatus.PENDING) {
    await transactions.transition(
      reference,
      { status: TransactionStatus.SUCCEEDED, reason: "Remboursement confirmé par l'opérateur" },
      current.version,
    );
  }
}

async function seedRefund(
  payments: PaymentsService,
  transactions: TransactionsService,
  parentReference: string,
  idempotencyKey: string,
  reason: string,
  amountOf: (parentAmount: bigint) => bigint,
): Promise<string> {
  const parent = await transactions.findByReferenceOrThrow(parentReference);
  const refundAmount = amountOf(parent.amount);
  const { transaction: refund } = await payments.createRefund(
    parentReference,
    { amount: String(refundAmount), reason },
    idempotencyKey,
    parent.merchantId,
  );
  await driveToSucceeded(transactions, refund.reference);
  return refund.reference;
}

/**
 * SUCCEEDED -> DISPUTED -> REVERSED (ADR 0006). État-aware comme
 * driveToSucceeded : reprend depuis le statut actuel, jamais une double
 * transition sur un rejeu.
 */
async function seedLostDispute(transactions: TransactionsService, reference: string): Promise<void> {
  let current = await transactions.findByReferenceOrThrow(reference);
  if (current.status === TransactionStatus.SUCCEEDED) {
    current = await transactions.transition(
      reference,
      { status: TransactionStatus.DISPUTED, reason: "Litige ouvert par le client (produit non reçu)" },
      current.version,
    );
  }
  if (current.status === TransactionStatus.DISPUTED) {
    await transactions.transition(
      reference,
      { status: TransactionStatus.REVERSED, reason: "Litige perdu — fonds repris par l'opérateur" },
      current.version,
    );
  }
}

async function seedRefundsAndDispute(
  payments: PaymentsService,
  transactions: TransactionsService,
  seeded: SeededTransaction[],
): Promise<void> {
  // Ciblage par POSITION dans `seeded` (scénarios d'index 0, 1, 2 —
  // toujours dans le groupe SUCCEEDED de buildScenarios(), voir l'ordre des
  // clés de OUTCOME_COUNTS), jamais par un filtre sur le statut COURANT :
  // rembourser partialTarget change justement son statut en
  // PARTIALLY_REFUNDED, donc un filtre "status === SUCCEEDED" réévalué à la
  // prochaine exécution du script exclurait cette transaction et décalerait
  // toute la sélection — corps différent pour la même idempotency-key,
  // 422 constaté en testant un rejeu.
  const [partialTarget, totalTarget, disputeTarget] = seeded;
  if (!partialTarget || !totalTarget || !disputeTarget) {
    throw new Error("Pas assez de transactions pour les remboursements/litige de démo");
  }

  console.log("--- Remboursements et litige ---");

  const partialRef = await seedRefund(
    payments,
    transactions,
    partialTarget.reference,
    "seed-demo-refund-partial",
    "Article manquant dans la commande",
    (amount) => amount / 2n,
  );
  console.log(`  remboursement partiel : ${partialRef} (sur ${partialTarget.reference})`);

  const totalRef = await seedRefund(
    payments,
    transactions,
    totalTarget.reference,
    "seed-demo-refund-total",
    "Commande annulée",
    (amount) => amount,
  );
  console.log(`  remboursement total   : ${totalRef} (sur ${totalTarget.reference})`);

  await seedLostDispute(transactions, disputeTarget.reference);
  console.log(`  litige perdu (REVERSED) : ${disputeTarget.reference}`);
}

async function main(): Promise<void> {
  // Script one-shot qui pilote lui-même expireOverduePending() (voir
  // withShortExpiry ci-dessus) : le vrai cron d'expiration (toutes les
  // minutes) tournerait en concurrence et peut faire échouer une
  // transaction Prisma en cours (P2028) — voir app.module.ts.
  process.env.EXPIRATION_CRON_ENABLED = "false";

  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const merchantsService = app.get(MerchantsService);
  const apiKeys = app.get(ApiKeysService);
  const payments = app.get(PaymentsService);
  const transactions = app.get(TransactionsService);

  const merchants = await seedMerchantsAndKeys(prisma, merchantsService, apiKeys);
  const seeded = await seedTransactions(payments, transactions, merchants);
  await seedRefundsAndDispute(payments, transactions, seeded);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
