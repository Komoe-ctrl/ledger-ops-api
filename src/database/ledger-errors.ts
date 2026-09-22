/**
 * Codes d'erreur levés par les règles d'intégrité en base (migration init_ledger).
 * La couche API les traduit en réponses HTTP stables (ex. LX005 -> 409 Conflict).
 */
export const LedgerErrorCode = {
  APPEND_ONLY: "LX001",
  UNBALANCED_ENTRY: "LX002",
  CURRENCY_MISMATCH: "LX003",
  SEALED_ENTRY: "LX004",
  INVALID_TRANSITION: "LX005",
  FROZEN_FIELD: "LX006",
  MISSING_ACTOR: "LX007",
  INVALID_REVERSAL: "LX008",
  INACTIVE_ACCOUNT: "LX009",
  BUSINESS_RULE: "LX010",
} as const;

export type LedgerErrorCode = (typeof LedgerErrorCode)[keyof typeof LedgerErrorCode];

const KNOWN_CODES = new Set<string>(Object.values(LedgerErrorCode));
const CODE_IN_MESSAGE = /\[(LX\d{3})\]/;

/** Extrait le code LX d'une erreur remontée par Prisma / le driver, sinon null. */
export function extractLedgerErrorCode(error: unknown): LedgerErrorCode | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = CODE_IN_MESSAGE.exec(message);
  const code = match?.[1];
  return code !== undefined && KNOWN_CODES.has(code) ? (code as LedgerErrorCode) : null;
}

export function isLedgerError(error: unknown, code?: LedgerErrorCode): boolean {
  const found = extractLedgerErrorCode(error);
  return found !== null && (code === undefined || found === code);
}
