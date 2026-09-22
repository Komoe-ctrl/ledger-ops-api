import { createHash, randomBytes } from "node:crypto";
import { Transaction } from "../database/prisma";
import { CreatePaymentDto } from "./dto/create-payment.dto";

/**
 * Empreinte SHA-256 du corps "normalisé" : un objet reconstruit avec un
 * ordre de clés fixe, pas celui — non garanti — du JSON reçu. Deux corps
 * sémantiquement identiques envoyés avec des clés dans un ordre différent
 * doivent produire la même empreinte.
 */
export function fingerprintOf(dto: CreatePaymentDto): string {
  const canonical = JSON.stringify({
    provider: dto.provider,
    amount: dto.amount,
    currency: dto.currency,
    customerMsisdn: dto.customerMsisdn,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Référence interne lisible, ex. "TXN-20260922-8F3K2Q" (voir schema.prisma). */
export function generateTransactionReference(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `TXN-${date}-${suffix}`;
}

/**
 * `amount` est un bigint côté Prisma/TS (ADR 0002) : JSON.stringify plante
 * dessus (TypeError: Do not know how to serialize a BigInt). On le
 * sérialise nous-mêmes en chaîne, jamais en `number`, pour ne pas perdre
 * de précision sur de gros montants.
 */
export function toPaymentResponse(transaction: Transaction) {
  return {
    reference: transaction.reference,
    status: transaction.status,
    provider: transaction.provider,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    customerMsisdn: transaction.customerMsisdn,
    createdAt: transaction.createdAt,
  };
}
