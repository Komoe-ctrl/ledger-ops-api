import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { ApiKeysService } from "../../src/auth/api-keys.service";
import { MerchantsService } from "../../src/merchants/merchants.service";
import { ApiRole } from "../../src/database/prisma";
import { authHeader, createTestApp, seedTestApiKeys, TestApiKeys, uniqueIdempotencyKey } from "./support/test-app";

type Posting = { accountCode: string; direction: "DEBIT" | "CREDIT"; amount: string; currency: string };
type Entry = {
  description: string;
  transactionReference: string;
  postings: Posting[];
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
};
type TimelineEvent = { transactionReference: string; transactionType: string; fromStatus: string | null; toStatus: string; actorType: string };
type Audit = {
  transaction: { reference: string; status: string; amount: string; refundedAmount: string };
  parentReference: string | null;
  refunds: { reference: string; status: string; amount: string }[];
  timeline: TimelineEvent[];
  entries: Entry[] | null;
};

describe("GET /v1/transactions/:reference/audit (e2e)", () => {
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

  async function createPayment(rawKey: string, amount: string): Promise<string> {
    const res = await request(server)
      .post("/v1/payments")
      .set(...authHeader(rawKey))
      .set("Idempotency-Key", uniqueIdempotencyKey("audit"))
      .send({ provider: "WAVE", amount, currency: "XOF", customerMsisdn: "+2250700000888" })
      .expect(201);
    return res.body.reference as string;
  }

  /** Enchaîne les transitions en rejouant la version attendue (If-Match) à chaque étape. */
  async function transition(reference: string, steps: { status: string; providerReference?: string }[]): Promise<void> {
    for (const step of steps) {
      const current = await request(server)
        .get(`/v1/transactions/${reference}`)
        .set(...authHeader(keys.operator))
        .expect(200);
      await request(server)
        .patch(`/v1/transactions/${reference}/status`)
        .set(...authHeader(keys.operator))
        .set("If-Match", String(current.body.version))
        .send(step)
        .expect(200);
    }
  }

  const succeed = (reference: string) =>
    transition(reference, [{ status: "PENDING" }, { status: "SUCCEEDED", providerReference: `WV-${crypto.randomUUID()}` }]);

  async function getAudit(reference: string, rawKey: string): Promise<Audit> {
    const res = await request(server)
      .get(`/v1/transactions/${reference}/audit`)
      .set(...authHeader(rawKey))
      .expect(200);
    return res.body as Audit;
  }

  it("refuse une requête sans clé (401)", async () => {
    await request(server).get("/v1/transactions/TXN-INCONNUE/audit").expect(401);
  });

  it("répond 404 pour une référence inconnue", async () => {
    await request(server)
      .get("/v1/transactions/TXN-INCONNUE/audit")
      .set(...authHeader(keys.analyst))
      .expect(404);
  });

  it("donne la chronologie d'un paiement et son écriture comptable équilibrée", async () => {
    const reference = await createPayment(keys.merchant, "10000");
    await succeed(reference);

    const audit = await getAudit(reference, keys.analyst);

    expect(audit.parentReference).toBeNull();
    expect(audit.refunds).toEqual([]);
    expect(audit.timeline.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "INITIATED"],
      ["INITIATED", "PENDING"],
      ["PENDING", "SUCCEEDED"],
    ]);
    expect(audit.timeline.every((e) => e.transactionReference === reference)).toBe(true);

    expect(audit.entries).toHaveLength(1);
    const entry = audit.entries![0];
    expect(entry.transactionReference).toBe(reference);
    expect(entry.balanced).toBe(true);
    expect(entry.totalDebit).toBe("10000");
    expect(entry.totalCredit).toBe("10000");
    // Débits d'abord, puis crédits ; montants en chaîne.
    const directions = entry.postings.map((p) => p.direction);
    expect(directions).toEqual([...directions].sort((a, b) => (a === b ? 0 : a === "DEBIT" ? -1 : 1)));
    expect(entry.postings.every((p) => typeof p.amount === "string" && p.currency === "XOF")).toBe(true);
  });

  it("n'a pas d'écriture tant que le paiement n'a pas abouti (liste vide, pas null)", async () => {
    const reference = await createPayment(keys.merchant, "3000");

    const audit = await getAudit(reference, keys.analyst);

    expect(audit.entries).toEqual([]);
    expect(audit.timeline).toHaveLength(1);
  });

  it("inclut le remboursement dans la chronologie et ses écritures, des deux côtés", async () => {
    const reference = await createPayment(keys.merchant, "8000");
    await succeed(reference);
    const refund = await request(server)
      .post(`/v1/payments/${reference}/refunds`)
      .set(...authHeader(keys.merchant))
      .set("Idempotency-Key", uniqueIdempotencyKey("audit-refund"))
      .send({ amount: "2000" })
      .expect(201);
    const refundReference = refund.body.reference as string;
    await succeed(refundReference);

    const audit = await getAudit(reference, keys.analyst);

    expect(audit.refunds).toEqual([expect.objectContaining({ reference: refundReference, amount: "2000", status: "SUCCEEDED" })]);
    expect(audit.transaction.status).toBe("PARTIALLY_REFUNDED");
    expect(audit.transaction.refundedAmount).toBe("2000");
    expect(audit.timeline.some((e) => e.transactionReference === refundReference && e.transactionType === "REFUND")).toBe(true);
    expect(audit.timeline.some((e) => e.transactionReference === reference && e.toStatus === "PARTIALLY_REFUNDED")).toBe(true);
    expect(audit.entries!.map((e) => e.transactionReference).sort()).toEqual([reference, refundReference].sort());
    expect(audit.entries!.every((e) => e.balanced)).toBe(true);

    // Depuis le remboursement : on retrouve le paiement parent.
    const fromRefund = await getAudit(refundReference, keys.analyst);
    expect(fromRefund.parentReference).toBe(reference);
    expect(fromRefund.refunds).toEqual([]);
  });

  it("montre un litige perdu (DISPUTED puis REVERSED) et sa contre-écriture", async () => {
    const reference = await createPayment(keys.merchant, "6000");
    await succeed(reference);
    await transition(reference, [{ status: "DISPUTED" }, { status: "REVERSED" }]);

    const audit = await getAudit(reference, keys.analyst);

    expect(audit.timeline.map((e) => e.toStatus)).toEqual(["INITIATED", "PENDING", "SUCCEEDED", "DISPUTED", "REVERSED"]);
    expect(audit.entries).toHaveLength(2);
    expect(audit.entries!.some((e) => e.description.startsWith("Litige perdu"))).toBe(true);
    expect(audit.entries!.every((e) => e.balanced)).toBe(true);
  });

  describe("rôle MERCHANT", () => {
    it("voit la chronologie de ses transactions mais pas les écritures (null)", async () => {
      const reference = await createPayment(keys.merchant, "5000");
      await succeed(reference);

      const audit = await getAudit(reference, keys.merchant);

      expect(audit.timeline).toHaveLength(3);
      expect(audit.entries).toBeNull();
    });

    it("ne peut pas auditer la transaction d'un autre marchand (404, pas 403)", async () => {
      const merchants = app.get(MerchantsService);
      const other = await merchants.create({ code: `audit_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`, name: "Autre marchand" });
      const otherKey = await app.get(ApiKeysService).create({ label: "e2e audit other", role: ApiRole.MERCHANT, merchantId: other.id });
      const reference = await createPayment(keys.merchant, "4000");

      await request(server)
        .get(`/v1/transactions/${reference}/audit`)
        .set(...authHeader(otherKey.rawKey))
        .expect(404);
    });
  });
});
