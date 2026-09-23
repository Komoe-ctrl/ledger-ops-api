import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { PrismaService } from "../../src/database/prisma.service";
import { TransactionsService } from "../../src/transactions/transactions.service";
import { createTestApp, uniqueIdempotencyKey } from "./support/test-app";

const VALID_PAYLOAD = {
  provider: "ORANGE_MONEY",
  amount: "5000",
  currency: "XOF",
  customerMsisdn: "+2250700000100",
};

describe("Expiration automatique (e2e)", () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let transactions: TransactionsService;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    transactions = app.get(TransactionsService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("expire une transaction PENDING dont l'échéance est dépassée, laisse les autres intactes", async () => {
    // Appelle le service directement plutôt que d'attendre le vrai cron
    // (@nestjs/schedule, toutes les minutes) : ce test vérifie la logique
    // du balayage, pas la plomberie de planification elle-même.
    const overdueKey = uniqueIdempotencyKey("expire-overdue");
    const overdue = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", overdueKey)
      .send(VALID_PAYLOAD)
      .expect(201);
    await request(server)
      .patch(`/v1/transactions/${overdue.body.reference}/status`)
      .set("If-Match", String(overdue.body.version))
      .send({ status: "PENDING" })
      .expect(200);
    // expiresAt n'est pas un champ figé (voir fn_transactions_before_update) :
    // le déplacer dans le passé ne nécessite pas de passer par withActor.
    await prisma.client.transaction.update({
      where: { reference: overdue.body.reference },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const controlKey = uniqueIdempotencyKey("expire-control");
    const control = await request(server)
      .post("/v1/payments")
      .set("Idempotency-Key", controlKey)
      .send(VALID_PAYLOAD)
      .expect(201);
    await request(server)
      .patch(`/v1/transactions/${control.body.reference}/status`)
      .set("If-Match", String(control.body.version))
      .send({ status: "PENDING" })
      .expect(200);
    // control garde son échéance par défaut (~15 min dans le futur).

    const expiredCount = await transactions.expireOverduePending();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const overdueAfter = await request(server).get(`/v1/transactions/${overdue.body.reference}`).expect(200);
    expect(overdueAfter.body.status).toBe("EXPIRED");

    const controlAfter = await request(server).get(`/v1/transactions/${control.body.reference}`).expect(200);
    expect(controlAfter.body.status).toBe("PENDING");
  });
});
