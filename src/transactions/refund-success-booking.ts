import { UnprocessableEntityException } from "@nestjs/common";
import { EntryDirection, Prisma, Transaction, TransactionStatus } from "../database/prisma";

const MERCHANT_PAYABLE_CODE = "merchant:demo:payable";

/**
 * Écrit le remboursement au grand livre (ADR 0005 : écriture indépendante,
 * commission non reversée) ET met à jour le paiement parent (refundedAmount
 * cumulé, statut) — dans la même transaction SQL que le passage à SUCCEEDED
 * du remboursement.
 *
 * Verrou pessimiste sur le PARENT (pas seulement sur le remboursement
 * lui-même, déjà verrouillé par transactions.service.ts) : deux
 * remboursements partiels confirmés en même temps sur le même paiement
 * liraient sinon tous les deux le même refundedAmount de départ et
 * s'écraseraient l'un l'autre au lieu de cumuler.
 */
export async function bookRefundSuccess(tx: Prisma.TransactionClient, refund: Transaction): Promise<void> {
  if (!refund.parentTransactionId) {
    throw new Error(`Remboursement ${refund.reference} sans parentTransactionId — incohérence de données`);
  }

  const parentRows = await tx.$queryRaw<{ id: string; amount: bigint; refundedAmount: bigint }[]>`
    SELECT "id", "amount", "refunded_amount" AS "refundedAmount"
    FROM "transactions" WHERE "id" = ${refund.parentTransactionId} FOR UPDATE
  `;
  const parent = parentRows[0];
  if (!parent) {
    throw new Error(`Paiement parent de ${refund.reference} introuvable — incohérence de données`);
  }

  const newRefundedAmount = parent.refundedAmount + refund.amount;

  // Le CHECK "refunded_amount <= amount" en base rejetterait de toute façon
  // (23514), mais en un 500 brut peu informatif. Deux remboursements
  // individuellement valides à leur création (contre le reste remboursable
  // d'ALORS) peuvent dépasser le reste une fois tous les deux confirmés —
  // fenêtre de course étroite mais réelle vu que la création et la
  // confirmation sont deux appels séparés dans le temps.
  if (newRefundedAmount > parent.amount) {
    throw new UnprocessableEntityException(
      `Remboursement ${refund.reference} : dépasse le reste remboursable du paiement ` +
        `(reste ${parent.amount - parent.refundedAmount}, demandé ${refund.amount})`,
    );
  }

  const newParentStatus =
    newRefundedAmount === parent.amount ? TransactionStatus.REFUNDED : TransactionStatus.PARTIALLY_REFUNDED;

  await tx.transaction.update({
    where: { id: parent.id },
    data: { refundedAmount: newRefundedAmount, status: newParentStatus },
  });

  const clearingCode = `provider:${refund.provider.toLowerCase()}:clearing`;
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
      description: `Remboursement ${refund.reference}`,
      transactionId: refund.id,
    },
  });

  await tx.ledgerPosting.createMany({
    data: [
      {
        entryId: entry.id,
        accountId: idOf(MERCHANT_PAYABLE_CODE),
        direction: EntryDirection.DEBIT,
        amount: refund.amount,
        currency: refund.currency,
      },
      {
        entryId: entry.id,
        accountId: idOf(clearingCode),
        direction: EntryDirection.CREDIT,
        amount: refund.amount,
        currency: refund.currency,
      },
    ],
  });
}
