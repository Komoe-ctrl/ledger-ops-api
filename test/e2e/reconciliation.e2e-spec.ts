import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { authHeader, createTestApp, seedTestApiKeys, TestApiKeys, uniqueIdempotencyKey } from "./support/test-app";

const VALID_PAYLOAD = {
  provider: "ORANGE_MONEY",
  amount: "7000",
  currency: "XOF",
  customerMsisdn: "+2250700000300",
};

describe("Acquittement tardif / rapprochement (e2e)", () => {
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

  it("capture un acquittement tardif sur une transaction EXPIRED, sans jamais la faire réussir", async () => {
    const key = uniqueIdempotencyKey("reconciliation");
    const created = await request(server)
      .post("/v1/payments")
      .set(...authHeader(keys.merchant))
      .set("Idempotency-Key", key)
      .send(VALID_PAYLOAD)
      .expect(201);
    const reference = created.body.reference as string;

    // Amène la transaction jusqu'à EXPIRED directement (le mécanisme du
    // vrai balayage périodique est déjà couvert par expiration.e2e-spec.ts
    // — ce test-ci porte sur ce qui se passe APRÈS, pas sur comment on y
    // arrive).
    await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set(...authHeader(keys.operator))
      .set("If-Match", String(created.body.version))
      .send({ status: "PENDING" })
      .expect(200);
    await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set(...authHeader(keys.operator))
      .set("If-Match", "2")
      .send({ status: "EXPIRED" })
      .expect(200);

    // L'acquittement tardif de l'opérateur : jamais EXPIRED -> SUCCEEDED.
    const lateAck = await request(server)
      .patch(`/v1/transactions/${reference}/status`)
      .set(...authHeader(keys.operator))
      .set("If-Match", "3")
      .send({ status: "SUCCEEDED", providerReference: "OM-998877" })
      .expect(409);
    expect(lateAck.body.title).toBe("ReconciliationRequired");

    // La transaction, elle, n'a pas bougé.
    const afterLateAck = await request(server)
      .get(`/v1/transactions/${reference}`)
      .set(...authHeader(keys.operator))
      .expect(200);
    expect(afterLateAck.body.status).toBe("EXPIRED");
    expect(afterLateAck.body.version).toBe(3);

    // L'exception existe et attend un analyste.
    const openList = await request(server)
      .get("/v1/reconciliation-exceptions?onlyUnresolved=true")
      .set(...authHeader(keys.analyst))
      .expect(200);
    const exception = openList.body.find((e: { transactionReference: string }) => e.transactionReference === reference);
    expect(exception).toBeDefined();
    expect(exception.reportedStatus).toBe("SUCCEEDED");
    expect(exception.providerReference).toBe("OM-998877");

    // Justification vide -> rejetée avant même d'atteindre la base.
    await request(server)
      .patch(`/v1/reconciliation-exceptions/${exception.id}/resolve`)
      .set(...authHeader(keys.analyst))
      .send({ resolution: "   " })
      .expect(400);

    // Réservé à ANALYST/ADMIN.
    await request(server)
      .patch(`/v1/reconciliation-exceptions/${exception.id}/resolve`)
      .set(...authHeader(keys.merchant))
      .send({ resolution: "Confirmé côté opérateur, traité manuellement." })
      .expect(403);

    // Résolution valide.
    const resolved = await request(server)
      .patch(`/v1/reconciliation-exceptions/${exception.id}/resolve`)
      .set(...authHeader(keys.analyst))
      .send({ resolution: "Confirmé côté opérateur, traité manuellement." })
      .expect(200);
    // resolvedBy est désormais dérivé de la clé API authentifiée, jamais du corps de requête.
    expect(typeof resolved.body.resolvedBy).toBe("string");
    expect(resolved.body.resolvedBy.length).toBeGreaterThan(0);

    // Une deuxième résolution est refusée — jamais réécrite.
    await request(server)
      .patch(`/v1/reconciliation-exceptions/${exception.id}/resolve`)
      .set(...authHeader(keys.analyst))
      .send({ resolution: "tentative" })
      .expect(409);
  });
});
