import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { ApiKeysService } from "../../src/auth/api-keys.service";
import { MerchantsService } from "../../src/merchants/merchants.service";
import { PrismaService } from "../../src/database/prisma.service";
import { ReconciliationService } from "../../src/reconciliation/reconciliation.service";
import { ApiRole } from "../../src/database/prisma";
import { authHeader, createTestApp, seedTestApiKeys, TestApiKeys, uniqueIdempotencyKey } from "./support/test-app";

type StatusCount = { status: string; count: number };
type Stats = {
  scope: "GLOBAL" | "MERCHANT";
  totalTransactions: number;
  byStatus: StatusCount[];
  payments: { total: number; byStatus: StatusCount[] };
  openReconciliationExceptions: number | null;
  demoDatasetLoadedAt: string | null;
  reconciliation: {
    windowStart: string;
    windowEnd: string;
    settledTransactions: number;
    reconciledTransactions: number;
  } | null;
};

const ALL_STATUSES = [
  "INITIATED",
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "DISPUTED",
  "REVERSED",
];

const countOf = (counts: StatusCount[], status: string): number => counts.find((c) => c.status === status)?.count ?? -1;
const sumOf = (counts: StatusCount[]): number => counts.reduce((acc, c) => acc + c.count, 0);

describe("GET /v1/stats (e2e)", () => {
  let app: INestApplication;
  let server: Server;
  let keys: TestApiKeys;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    keys = await seedTestApiKeys(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function getStats(rawKey: string): Promise<Stats> {
    const res = await request(server)
      .get("/v1/stats")
      .set(...authHeader(rawKey))
      .expect(200);
    return res.body as Stats;
  }

  async function createPayment(rawKey: string, amount = "5000"): Promise<{ reference: string; version: number }> {
    const res = await request(server)
      .post("/v1/payments")
      .set(...authHeader(rawKey))
      .set("Idempotency-Key", uniqueIdempotencyKey("stats"))
      .send({ provider: "WAVE", amount, currency: "XOF", customerMsisdn: "+2250700000777" })
      .expect(201);
    return res.body as { reference: string; version: number };
  }

  async function succeed(reference: string): Promise<void> {
    await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set(...authHeader(keys.operator))
      .set("If-Match", "1")
      .send({ status: "PENDING" })
      .expect(200);
    await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set(...authHeader(keys.operator))
      .set("If-Match", "2")
      .send({ status: "SUCCEEDED", providerReference: `WV-${crypto.randomUUID()}` })
      .expect(200);
  }

  it("refuse une requête sans clé (401)", async () => {
    await request(server).get("/v1/stats").expect(401);
  });

  it("n'annonce aucune date de chargement tant que le jeu n'a jamais été chargé (null, pas une déduction)", async () => {
    const stats = await getStats(keys.admin);
    expect(stats.demoDatasetLoadedAt).toBeNull();
  });

  it("expose le dernier chargement enregistré, sous forme de date ISO", async () => {
    const prisma = app.get(PrismaService);
    await prisma.client.demoDatasetLoad.create({ data: {} });
    const latest = await prisma.client.demoDatasetLoad.create({ data: {} });

    const stats = await getStats(keys.analyst);
    expect(stats.demoDatasetLoadedAt).toBe(latest.loadedAt.toISOString());
    // Chargements sans début connu : pas de fenêtre, donc pas de taux inventé.
    expect(stats.reconciliation).toBeNull();
  });

  describe("portée MERCHANT", () => {
    let merchantKey: string;

    beforeAll(async () => {
      const merchants = app.get(MerchantsService);
      const apiKeys = app.get(ApiKeysService);
      const merchant = await merchants.create({ code: `stats_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`, name: "Marchand stats" });
      const created = await apiKeys.create({ label: "e2e stats merchant", role: ApiRole.MERCHANT, merchantId: merchant.id });
      merchantKey = created.rawKey;
    });

    it("renvoie des zéros complets pour un marchand sans transaction, tous statuts présents", async () => {
      const stats = await getStats(merchantKey);

      expect(stats.scope).toBe("MERCHANT");
      expect(stats.totalTransactions).toBe(0);
      expect(stats.payments.total).toBe(0);
      expect(stats.byStatus.map((c) => c.status)).toEqual(ALL_STATUSES);
      expect(sumOf(stats.byStatus)).toBe(0);
    });

    it("ne compte que ses propres transactions, jamais celles des autres marchands", async () => {
      const first = await createPayment(merchantKey);
      await createPayment(merchantKey);
      await succeed(first.reference);
      // Une transaction d'un AUTRE marchand (le marchand "demo") ne doit pas apparaître.
      await createPayment(keys.merchant);

      const stats = await getStats(merchantKey);

      expect(stats.totalTransactions).toBe(2);
      expect(stats.payments.total).toBe(2);
      expect(countOf(stats.byStatus, "SUCCEEDED")).toBe(1);
      expect(countOf(stats.byStatus, "INITIATED")).toBe(1);
      expect(sumOf(stats.byStatus)).toBe(stats.totalTransactions);
      expect(sumOf(stats.payments.byStatus)).toBe(stats.payments.total);
    });

    it("n'expose pas les exceptions de rapprochement à un marchand (null, pas 0)", async () => {
      const stats = await getStats(merchantKey);
      expect(stats.openReconciliationExceptions).toBeNull();
    });

    it("sépare les paiements des remboursements dans les comptages", async () => {
      const payment = await createPayment(merchantKey, "8000");
      await succeed(payment.reference);
      const before = await getStats(merchantKey);

      await request(server)
        .post(`/v1/payments/${payment.reference}/refunds`)
        .set(...authHeader(merchantKey))
        .set("Idempotency-Key", uniqueIdempotencyKey("stats-refund"))
        .send({ amount: "1000" })
        .expect(201);

      const after = await getStats(merchantKey);
      expect(after.totalTransactions).toBe(before.totalTransactions + 1);
      expect(after.payments.total).toBe(before.payments.total);
    });
  });

  describe("portée GLOBAL (ANALYST, OPERATOR, ADMIN)", () => {
    it("voit la plateforme entière et suit les nouvelles transactions", async () => {
      const before = await getStats(keys.admin);
      await createPayment(keys.merchant);
      const after = await getStats(keys.admin);

      expect(after.scope).toBe("GLOBAL");
      expect(after.totalTransactions).toBe(before.totalTransactions + 1);
      expect(countOf(after.byStatus, "INITIATED")).toBe(countOf(before.byStatus, "INITIATED") + 1);
      expect(sumOf(after.byStatus)).toBe(after.totalTransactions);
    });

    it.each([
      ["ANALYST", "analyst"],
      ["OPERATOR", "operator"],
    ] as const)("%s voit la même vue globale que ADMIN", async (_role, keyName) => {
      const admin = await getStats(keys.admin);
      const other = await getStats(keys[keyName]);
      expect(other).toEqual(admin);
    });

    it("compte les exceptions de rapprochement ouvertes, et ne compte plus une exception résolue", async () => {
      const before = await getStats(keys.analyst);
      expect(before.openReconciliationExceptions).not.toBeNull();

      const reconciliation = app.get(ReconciliationService);
      const exception = await reconciliation.reportDiscrepancy({
        kind: "MISSING_LOCALLY",
        providerReference: `WV-GHOST-${crypto.randomUUID()}`,
        detail: "Ligne de relevé sans transaction locale (test stats)",
      });

      const opened = await getStats(keys.analyst);
      expect(opened.openReconciliationExceptions).toBe(before.openReconciliationExceptions! + 1);

      await request(server)
        .patch(`/v1/reconciliation-exceptions/${exception.id}/resolve`)
        .set(...authHeader(keys.analyst))
        .send({ resolution: "Résolu pour le test des stats" })
        .expect(200);

      const resolved = await getStats(keys.analyst);
      expect(resolved.openReconciliationExceptions).toBe(before.openReconciliationExceptions);
    });
  });

  // Dernier bloc du fichier : il inscrit un chargement AVEC début de fenêtre, ce qui
  // fixe la fenêtre pour tout ce qui s'exécute après lui (ADR 0009).
  describe("taux de rapprochement (fenêtre du jeu de démonstration)", () => {
    const dbNow = async (): Promise<Date> => {
      const [{ now }] = await app.get(PrismaService).client.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      return now;
    };
    const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
    let openExceptionId = "";

    it("compte les transactions dénouées de la fenêtre, moins celles ayant une exception ouverte", async () => {
      const prisma = app.get(PrismaService);
      const reconciliation = app.get(ReconciliationService);

      // Hors fenêtre : dénouée avant le début du chargement, ne doit pas être comptée.
      const before = await createPayment(keys.merchant);
      await succeed(before.reference);
      await pause();
      const windowStart = await dbNow();
      await pause();

      const clean = await createPayment(keys.merchant);
      await succeed(clean.reference);
      const withOpen = await createPayment(keys.merchant);
      await succeed(withOpen.reference);
      const withResolved = await createPayment(keys.merchant);
      await succeed(withResolved.reference);
      await createPayment(keys.merchant); // INITIATED : pas dénouée, hors dénominateur

      const idOf = async (reference: string) =>
        (await prisma.client.transaction.findUniqueOrThrow({ where: { reference }, select: { id: true } })).id;
      const open = await reconciliation.reportDiscrepancy({
        kind: "AMOUNT_MISMATCH",
        transactionId: await idOf(withOpen.reference),
        detail: "Écart de montant (test taux de rapprochement) — reste ouvert",
      });
      openExceptionId = open.id;
      const resolvedException = await reconciliation.reportDiscrepancy({
        kind: "AMOUNT_MISMATCH",
        transactionId: await idOf(withResolved.reference),
        detail: "Écart de montant (test taux de rapprochement) — sera résolu",
      });
      await request(server)
        .patch(`/v1/reconciliation-exceptions/${resolvedException.id}/resolve`)
        .set(...authHeader(keys.analyst))
        .send({ resolution: "Vérifié auprès de l'opérateur" })
        .expect(200);

      await prisma.client.demoDatasetLoad.create({ data: { startedAt: windowStart } });

      const stats = await getStats(keys.analyst);
      expect(stats.reconciliation).not.toBeNull();
      expect(stats.reconciliation!.settledTransactions).toBe(3);
      expect(stats.reconciliation!.reconciledTransactions).toBe(2);
      expect(stats.reconciliation!.windowStart).toBe(windowStart.toISOString());
      expect(stats.reconciliation!.windowEnd).toBe(stats.demoDatasetLoadedAt);
    });

    it("compte de nouveau comme rapprochée une transaction dont l'exception vient d'être résolue", async () => {
      const before = (await getStats(keys.admin)).reconciliation!;

      await request(server)
        .patch(`/v1/reconciliation-exceptions/${openExceptionId}/resolve`)
        .set(...authHeader(keys.analyst))
        .send({ resolution: "Résolu pour le test" })
        .expect(200);

      const after = (await getStats(keys.admin)).reconciliation!;
      expect(after.settledTransactions).toBe(before.settledTransactions);
      expect(after.reconciledTransactions).toBe(before.reconciledTransactions + 1);
    });

    it("n'expose pas ce taux à un marchand (null)", async () => {
      const stats = await getStats(keys.merchant);
      expect(stats.reconciliation).toBeNull();
    });
  });
});
