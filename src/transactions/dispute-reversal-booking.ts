import { EntryDirection, Prisma, Transaction } from "../database/prisma";

const MERCHANT_PAYABLE_CODE = "merchant:demo:payable";

/**
 * Litige perdu (DISPUTED -> REVERSED, ADR 0006) : reprend tout ce qui
 * restait dû au marchand, avec le même mécanisme à deux lignes qu'un
 * remboursement (ADR 0005) — commission non reversée, par cohérence.
 *
 * `remaining` est garanti > 0 par la machine à états : une transaction
 * déjà REFUNDED en totalité (refunded_amount = amount) n'a aucune sortie
 * vers DISPUTED dans transaction_status_transitions.
 *
 * Renvoie la transaction mise à jour : contrairement à bookPaymentSuccess/
 * bookRefundSuccess (qui ne modifient jamais la ligne qu'on leur a
 * donnée — seulement d'autres comptes, ou le PARENT), cette fonction
 * modifie la MÊME ligne que celle reçue (son propre refunded_amount).
 * L'appelant doit réutiliser ce retour, pas l'objet qu'il avait avant.
 */
export async function bookDisputeReversal(
  tx: Prisma.TransactionClient,
  transaction: Transaction,
): Promise<Transaction> {
  const remaining = transaction.amount - transaction.refundedAmount;
  if (remaining <= 0n) {
    throw new Error(
      `Litige ${transaction.reference} : rien à reprendre (refunded_amount déjà égal à amount) — ` +
        "incohérence avec la machine à états attendue",
    );
  }

  const updated = await tx.transaction.update({
    where: { id: transaction.id },
    data: { refundedAmount: transaction.amount },
  });

  const clearingCode = `provider:${transaction.provider.toLowerCase()}:clearing`;
  const accounts = await tx.ledgerAccount.findMany({
    where: { code: { in: [clearingCode, MERCHANT_PAYABLE_CODE] } },
  });
  const idOf = (code: string): string => {
    const account = accounts.find((a) => a.code === code);
    if (!account) {
      throw new Error(`Compte comptable "${code}" introuvable — plan comptable incomplet`);
    }
    return account.id;
  };

  const entry = await tx.journalEntry.create({
    data: {
      description: `Litige perdu ${transaction.reference}`,
      transactionId: transaction.id,
    },
  });

  await tx.ledgerPosting.createMany({
    data: [
      {
        entryId: entry.id,
        accountId: idOf(MERCHANT_PAYABLE_CODE),
        direction: EntryDirection.DEBIT,
        amount: remaining,
        currency: transaction.currency,
      },
      {
        entryId: entry.id,
        accountId: idOf(clearingCode),
        direction: EntryDirection.CREDIT,
        amount: remaining,
        currency: transaction.currency,
      },
    ],
  });

  return updated;
}
