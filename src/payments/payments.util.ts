import { createHash, randomBytes } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { CreateRefundDto } from "./dto/create-refund.dto";

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

export function refundFingerprintOf(parentReference: string, dto: CreateRefundDto): string {
  const canonical = JSON.stringify({ parentReference, amount: dto.amount });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Utilisé par POST /v1/payments et POST /v1/payments/:reference/refunds. */
export function requireIdempotencyKey(header: string | undefined): string {
  if (!header || header.length === 0) {
    throw new BadRequestException("En-tête Idempotency-Key obligatoire");
  }
  if (header.length > 100) {
    throw new BadRequestException("Idempotency-Key trop longue (100 caractères max)");
  }
  return header;
}

/** Référence interne lisible, ex. "TXN-20260922-8F3K2Q" (voir schema.prisma). */
export function generateTransactionReference(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `TXN-${date}-${suffix}`;
}

/**
 * Fenêtre d'attente d'une confirmation opérateur (paiement ou remboursement)
 * avant expiration automatique. 15 min : ordre de grandeur usuel mobile
 * money (varie de 5 à 30 min selon l'opérateur en réalité — valeur figée
 * ici faute de source produit, à revoir si besoin).
 */
const PENDING_EXPIRY_MINUTES = 15;

export function computeExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + PENDING_EXPIRY_MINUTES * 60_000);
}
