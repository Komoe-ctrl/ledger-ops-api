import { createHash, randomBytes } from "node:crypto";
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
