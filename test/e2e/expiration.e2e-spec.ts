import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import request from "supertest";
import { Clock } from "../../src/common/clock";
import { TransactionsService } from "../../src/transactions/transactions.service";
import { ControllableClock, createTestApp, uniqueIdempotencyKey } from "./support/test-app";

const VALID_PAYLOAD = {
  provider: "ORANGE_MONEY",
  amount: "5000",
  currency: "XOF",
  customerMsisdn: "+2250700000100",
};

describe("Expiration automatique (e2e)", () => {
  let app: INestApplication;
  let server: Server;
  let transactions: TransactionsService;
  let clock: ControllableClock;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    transactions = app.get(TransactionsService);
    clock = app.get(Clock) as ControllableClock;
  });

  afterAll(async () => {
    await app.close();
  });

  it("expire une transaction PENDING dont l'échéance est dépassée, laisse les autres intactes", async () => {
    // Appelle le service directement plutôt que d'attendre le vrai cron
    // (@nestjs/schedule, toutes les minutes) : ce test vérifie la logique
    // du balayage, pas la plomberie de planification elle-même.
    //
    // `created_at` est TOUJOURS l'heure réelle du serveur Postgres (imposé
    // par fn_transactions_before_insert, quoi que l'app envoie) — impossible
    // de le truquer. On ne peut donc pas faire naître une transaction déjà
    // échue (ça violerait le CHECK expires_at > created_at ajouté au point
    // 2). À la place : on crée normalement (échéance ~15 min dans le futur
    // réel), puis on avance l'horloge que LE BALAYAGE consulte, pour lui
    // faire croire qu'on est bien plus tard — sans attendre 15 minutes.
    const realNow = new Date();
    clock.setNow(realNow);

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

    // Avancée AVANT de créer le témoin : son échéance (calculée à partir de
    // cette nouvelle heure) reste dans le futur relatif à elle, alors que
    // celle d'`overdue` (calculée avant l'avancée) ne l'est plus.
    clock.setNow(new Date(realNow.getTime() + 20 * 60_000));

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

    const expiredCount = await transactions.expireOverduePending();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const overdueAfter = await request(server).get(`/v1/transactions/${overdue.body.reference}`).expect(200);
    expect(overdueAfter.body.status).toBe("EXPIRED");

    const controlAfter = await request(server).get(`/v1/transactions/${control.body.reference}`).expect(200);
    expect(controlAfter.body.status).toBe("PENDING");
  });
});
