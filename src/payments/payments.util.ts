import { createHash, randomBytes } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Provider } from "../database/prisma";
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
 * Défaut faute de configuration explicite. Approximatif : en réalité, un
 * push USSD expire plutôt entre 2 et 5 min selon l'opérateur — voir
 * docs/adr/0007-acquittement-tardif.md. Configurable par opérateur
 * (PAYMENT_EXPIRY_MINUTES_<PROVIDER>) ou globalement
 * (PAYMENT_EXPIRY_MINUTES_DEFAULT), sinon cette valeur.
 */
const FALLBACK_EXPIRY_MINUTES = 15;

const EXPIRY_ENV_KEY_BY_PROVIDER: Record<Provider, string> = {
  ORANGE_MONEY: "PAYMENT_EXPIRY_MINUTES_ORANGE_MONEY",
  MTN_MOMO: "PAYMENT_EXPIRY_MINUTES_MTN_MOMO",
  WAVE: "PAYMENT_EXPIRY_MINUTES_WAVE",
  MOOV_MONEY: "PAYMENT_EXPIRY_MINUTES_MOOV_MONEY",
};

export function resolveExpiryMinutes(config: ConfigService, provider: Provider): number {
  const perProvider = config.get<number>(EXPIRY_ENV_KEY_BY_PROVIDER[provider]);
  if (perProvider !== undefined) {
    return perProvider;
  }
  return config.get<number>("PAYMENT_EXPIRY_MINUTES_DEFAULT") ?? FALLBACK_EXPIRY_MINUTES;
}

/** Pur : ne lit ni l'horloge ni la config — reçoit tout ce dont il a besoin. */
export function computeExpiresAt(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}
