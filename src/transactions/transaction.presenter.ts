import { Transaction, TransactionStatusHistory } from "../database/prisma";

/**
 * `amount`/`refundedAmount` sont des bigint côté Prisma/TS (ADR 0002) :
 * `JSON.stringify` natif plante dessus. On les sérialise nous-mêmes en
 * chaîne, jamais en `number`, pour ne pas perdre de précision.
 * Partagé entre payments (réponse de création) et transactions (lecture).
 */
export function toTransactionResponse(transaction: Transaction) {
  return {
    reference: transaction.reference,
    type: transaction.type,
    status: transaction.status,
    provider: transaction.provider,
    amount: transaction.amount.toString(),
    currency: transaction.currency,
    customerMsisdn: transaction.customerMsisdn,
    refundedAmount: transaction.refundedAmount.toString(),
    version: transaction.version,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

export function toHistoryResponse(entry: TransactionStatusHistory) {
  return {
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorType: entry.actorType,
    actorId: entry.actorId,
    reason: entry.reason,
    createdAt: entry.createdAt,
  };
}
