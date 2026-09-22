import { EntryDirection, Prisma, Transaction } from "../database/prisma";

const MERCHANT_PAYABLE_CODE = "merchant:demo:payable";
const FEES_CODE = "revenue:fees";

/** 1,5 %, arrondi au franc inférieur — voir docs/adr/0004-commission-arrondi.md. */
export function computeCommission(amount: bigint): bigint {
  return (amount * 15n) / 1000n;
}

/**
 * Écriture comptable du paiement confirmé : débit compensation opérateur,
 * crédit dû marchand, crédit commissions. Appelée dans la même transaction
 * SQL que le passage à SUCCEEDED (voir ADR 0001 : les lignes d'une écriture
 * ne peuvent être ajoutées que dans la transaction qui l'a créée — LX004).
 */
export async function bookPaymentSuccess(tx: Prisma.TransactionClient, transaction: Transaction): Promise<void> {
  const clearingCode = `provider:${transaction.provider.toLowerCase()}:clearing`;

  const accounts = await tx.ledgerAccount.findMany({
    where: { code: { in: [clearingCode, MERCHANT_PAYABLE_CODE, FEES_CODE] } },
  });
  const idOf = (code: string): string => {
    const account = accounts.find((a) => a.code === code);
    if (!account) {
      throw new Error(`Compte comptable "${code}" introuvable — plan comptable incomplet`);
    }
    return account.id;
  };

  const commission = computeCommission(transaction.amount);
  const merchantAmount = transaction.amount - commission;

  const entry = await tx.journalEntry.create({
    data: {
      description: `Paiement ${transaction.reference}`,
      transactionId: transaction.id,
    },
  });

  const postings: Prisma.LedgerPostingCreateManyInput[] = [
    {
      entryId: entry.id,
      accountId: idOf(clearingCode),
      direction: EntryDirection.DEBIT,
      amount: transaction.amount,
      currency: transaction.currency,
    },
    {
      entryId: entry.id,
      accountId: idOf(MERCHANT_PAYABLE_CODE),
      direction: EntryDirection.CREDIT,
      amount: merchantAmount,
      currency: transaction.currency,
    },
  ];

  // Omis, pas posé à 0 : ledger_postings impose amount > 0.
  if (commission > 0n) {
    postings.push({
      entryId: entry.id,
      accountId: idOf(FEES_CODE),
      direction: EntryDirection.CREDIT,
      amount: commission,
      currency: transaction.currency,
    });
  }

  await tx.ledgerPosting.createMany({ data: postings });
}
