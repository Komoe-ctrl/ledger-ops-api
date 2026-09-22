import { IsEnum, Matches } from "class-validator";
import { Provider } from "../../database/prisma";

/**
 * Contrat HTTP de POST /v1/payments — distinct du modèle de domaine
 * (Transaction). Le DTO ne connaît que ce que l'appelant a le droit
 * d'envoyer : ni `reference` (générée), ni `providerReference` (posée
 * plus tard par l'opérateur), ni `idempotencyKey` (dans l'en-tête, pas
 * le corps — voir étape 6).
 */
export class CreatePaymentDto {
  @IsEnum(Provider, { message: "provider doit être l'un de : ORANGE_MONEY, MTN_MOMO, WAVE, MOOV_MONEY" })
  provider!: Provider;

  /**
   * Chaîne de chiffres, jamais un number JSON : un montant en unité mineure
   * peut dépasser Number.MAX_SAFE_INTEGER, et un flottant introduirait
   * l'imprécision qu'ADR 0002 interdit justement. Converti en bigint dans
   * le service, jamais ici.
   */
  @Matches(/^[1-9][0-9]*$/, {
    message: "amount doit être un entier positif, en unité mineure, sans zéro initial (ex. \"10000\")",
  })
  amount!: string;

  @Matches(/^[A-Z]{3}$/, { message: "currency doit être un code ISO 4217 (ex. XOF)" })
  currency!: string;

  @Matches(/^\+[1-9][0-9]{7,14}$/, { message: "customerMsisdn doit être au format E.164 (ex. +2250700000000)" })
  customerMsisdn!: string;
}
