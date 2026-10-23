import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { EntryDirection, Transaction } from "../database/prisma";
import { TransactionAuditResponseDto } from "./dto/transaction-audit-response.dto";
import { toTransactionResponse } from "./transaction.presenter";

type EntryTotals = { entry_id: string; total_debit: string; total_credit: string; balanced: boolean };

/**
 * Vue d'audit d'une transaction : chronologie des statuts (la sienne et celles
 * de ses remboursements) et écritures comptables. Lecture seule.
 */
@Injectable()
export class TransactionAuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** @param includeEntries false pour un MERCHANT : `entries` vaut alors null (jamais une liste vide trompeuse). */
  async build(transaction: Transaction, includeEntries: boolean): Promise<TransactionAuditResponseDto> {
    const client = this.prisma.client;

    const [refunds, parent] = await Promise.all([
      client.transaction.findMany({ where: { parentTransactionId: transaction.id }, orderBy: { createdAt: "asc" } }),
      transaction.parentTransactionId
        ? client.transaction.findUnique({ where: { id: transaction.parentTransactionId }, select: { reference: true } })
        : Promise.resolve(null),
    ]);

    const concerned = [transaction, ...refunds];
    const referenceById = new Map(concerned.map((t) => [t.id, t.reference]));
    const typeById = new Map(concerned.map((t) => [t.id, t.type]));
    const ids = concerned.map((t) => t.id);

    const history = await client.transactionStatusHistory.findMany({
      where: { transactionId: { in: ids } },
      orderBy: { createdAt: "asc" },
    });

    return {
      transaction: toTransactionResponse(transaction),
      parentReference: parent?.reference ?? null,
      refunds: refunds.map((r) => ({
        reference: r.reference,
        status: r.status,
        amount: r.amount.toString(),
        currency: r.currency,
        createdAt: r.createdAt,
      })),
      timeline: history.map((h) => ({
        transactionReference: referenceById.get(h.transactionId)!,
        transactionType: typeById.get(h.transactionId)!,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        actorType: h.actorType,
        actorId: h.actorId,
        reason: h.reason,
        createdAt: h.createdAt,
      })),
      entries: includeEntries ? await this.entries(ids, referenceById) : null,
    };
  }

  private async entries(transactionIds: string[], referenceById: Map<string, string>) {
    const client = this.prisma.client;
    const entries = await client.journalEntry.findMany({
      where: { transactionId: { in: transactionIds } },
      include: { postings: { include: { account: { select: { code: true, name: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    if (entries.length === 0) {
      return [];
    }

    // Totaux ET équilibre évalués par PostgreSQL : aucun montant n'est additionné ni comparé ici.
    const totals = await client.$queryRaw<EntryTotals[]>`
      SELECT entry_id,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text  AS total_debit,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text AS total_credit,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)
               = COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)   AS balanced
        FROM ledger_postings
       WHERE entry_id = ANY(${entries.map((e) => e.id)}::uuid[])
       GROUP BY entry_id`;
    const totalsByEntry = new Map(totals.map((t) => [t.entry_id, t]));

    return entries.map((entry) => {
      const t = totalsByEntry.get(entry.id);
      return {
        id: entry.id,
        description: entry.description,
        transactionReference: referenceById.get(entry.transactionId!)!,
        createdAt: entry.createdAt,
        postings: [...entry.postings]
          .sort((a, b) => Number(a.direction !== EntryDirection.DEBIT) - Number(b.direction !== EntryDirection.DEBIT))
          .map((p) => ({
            accountCode: p.account.code,
            accountName: p.account.name,
            direction: p.direction,
            amount: p.amount.toString(),
            currency: p.currency,
          })),
        totalDebit: t?.total_debit ?? "0",
        totalCredit: t?.total_credit ?? "0",
        balanced: t?.balanced ?? false,
      };
    });
  }
}
