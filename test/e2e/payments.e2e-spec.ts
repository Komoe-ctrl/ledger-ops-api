import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service";
import { createTestApp, uniqueIdempotencyKey } from "./support/test-app";

const VALID_PAYLOAD = {
  provider: "ORANGE_MONEY",
  amount: "10000",
  currency: "XOF",
  customerMsisdn: "+2250700000099",
};

describe("Payments & Transactions (e2e)", () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("cas nominal : crée une transaction INITIATED", async () => {
    const key = uniqueIdempotencyKey("nominal");

    const res = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);

    expect(res.body).toMatchObject({
      status: "INITIATED",
      provider: "ORANGE_MONEY",
      amount: "10000",
      version: 1,
    });
    expect(res.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("rejeu idempotent : même clé + même corps ne recrée rien", async () => {
    const key = uniqueIdempotencyKey("replay");

    const first = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);

    const second = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(200);

    expect(second.body.reference).toBe(first.body.reference);
    expect(second.headers["idempotent-replayed"]).toBe("true");

    const count = await prisma.client.transaction.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("clé réutilisée avec un corps différent -> 422", async () => {
    const key = uniqueIdempotencyKey("mismatch");

    await request(server).post("/v1/payments").set("Idempotency-Key", key).send(VALID_PAYLOAD).expect(201);

    const res = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send({ ...VALID_PAYLOAD, amount: "99999" })
      .expect(422);

    expect(res.body.status).toBe(422);
  });

  it(
    "10 requêtes concurrentes, même clé -> une seule création",
    async () => {
      const key = uniqueIdempotencyKey("race");

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(server).post("/v1/payments").set("Idempotency-Key", key).send(VALID_PAYLOAD),
        ),
      );

      const statuses = results.map((r) => r.status).sort((a, b) => a - b);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 200)).toHaveLength(9);

      const references = new Set(results.map((r) => r.body.reference));
      expect(references.size).toBe(1);

      const count = await prisma.client.transaction.count({ where: { idempotencyKey: key } });
      expect(count).toBe(1);
    },
    20000,
  );

  it("transition interdite (INITIATED -> SUCCEEDED) -> 409 LX005", async () => {
    const key = uniqueIdempotencyKey("forbidden-transition");
    const created = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);

    const res = await request(server)
      .patch(`/v1/transactions/${created.body.reference}/status`)
      .set("If-Match", String(created.body.version))
      .send({ status: "SUCCEEDED" })
      .expect(409);

    expect(res.body.code).toBe("LX005");
  });

  it("If-Match périmé -> 412", async () => {
    const key = uniqueIdempotencyKey("stale-etag");
    const created = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);

    // Consomme la version 1 : la transition réussit, la version passe à 2.
    await request(server)
      .patch(`/v1/transactions/${created.body.reference}/status`)
      .set("If-Match", String(created.body.version))
      .send({ status: "FAILED" })
      .expect(200);

    // Rejoue le MÊME If-Match : déjà périmé par la transition précédente.
    const stale = await request(server)
      .patch(`/v1/transactions/${created.body.reference}/status`)
      .set("If-Match", String(created.body.version))
      .send({ status: "FAILED" })
      .expect(412);

    expect(stale.body.status).toBe(412);
  });

  it("écriture comptable équilibrée après passage à SUCCEEDED", async () => {
    const key = uniqueIdempotencyKey("balanced-ledger");
    const created = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);
    const reference = created.body.reference as string;

    const pending = await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set("If-Match", String(created.body.version))
      .send({ status: "PENDING" })
      .expect(200);

    await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set("If-Match", String(pending.body.version))
      .send({ status: "SUCCEEDED" })
      .expect(200);

    const postings = await prisma.client.$queryRaw<{ direction: string; amount: bigint }[]>`
      SELECT lp.direction, lp.amount
      FROM ledger_postings lp
      JOIN journal_entries je ON je.id = lp.entry_id
      JOIN transactions t ON t.id = je.transaction_id
      WHERE t.reference = ${reference}
    `;

    const debit = postings.filter((p) => p.direction === "DEBIT").reduce((sum, p) => sum + p.amount, 0n);
    const credit = postings.filter((p) => p.direction === "CREDIT").reduce((sum, p) => sum + p.amount, 0n);

    expect(debit).toBe(10000n);
    expect(credit).toBe(10000n);
  });
});
