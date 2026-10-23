import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { TransactionStatus, TransactionType } from "../database/prisma";
import { PaymentStatsDto, ReconciliationStatsDto, StatsResponseDto, StatusCountDto } from "./dto/stats-response.dto";

const ALL_STATUSES = Object.values(TransactionStatus);

/** Pas encore dénoué : l'opérateur n'a pas rendu de verdict, il n'y a rien à rapprocher (ADR 0009). */
const IN_PROGRESS_STATUSES = [TransactionStatus.INITIATED, TransactionStatus.PENDING];

/** Tous les statuts, y compris à 0 : le front n'a ainsi jamais à deviner qu'une clé absente vaut zéro. */
function toStatusCounts(counts: Map<TransactionStatus, number>): StatusCountDto[] {
  return ALL_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

@Injectable()
export class StatsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Tous les comptages sont faits par PostgreSQL (GROUP BY / COUNT / MAX) ;
   * rien n'est agrégé en mémoire à part le regroupement des quelques lignes
   * (type, statut) déjà comptées.
   *
   * @param merchantId borne la portée au marchand de la clé (rôle MERCHANT) ;
   *   absent = vue globale. Les exceptions de rapprochement ne sont jamais
   *   exposées à un marchand (null), pas estimées.
   */
  async compute(merchantId: string | undefined): Promise<StatsResponseDto> {
    const [grouped, openExceptions, lastLoad] = await Promise.all([
      this.prisma.client.transaction.groupBy({
        by: ["type", "status"],
        where: merchantId ? { merchantId } : {},
        _count: { _all: true },
      }),
      merchantId ? Promise.resolve(null) : this.prisma.client.reconciliationException.count({ where: { resolvedAt: null } }),
      this.prisma.client.demoDatasetLoad.aggregate({ _max: { loadedAt: true }, _min: { startedAt: true } }),
    ]);

    const all = new Map<TransactionStatus, number>();
    const payments = new Map<TransactionStatus, number>();
    let totalTransactions = 0;
    let totalPayments = 0;
    for (const row of grouped) {
      const count = row._count._all;
      all.set(row.status, (all.get(row.status) ?? 0) + count);
      totalTransactions += count;
      if (row.type === TransactionType.PAYMENT) {
        payments.set(row.status, (payments.get(row.status) ?? 0) + count);
        totalPayments += count;
      }
    }

    const windowStart = lastLoad._min.startedAt;
    const windowEnd = lastLoad._max.loadedAt;
    const reconciliation = merchantId || !windowStart || !windowEnd ? null : await this.reconciliation(windowStart, windowEnd);

    const paymentStats: PaymentStatsDto = { total: totalPayments, byStatus: toStatusCounts(payments) };
    return {
      scope: merchantId ? "MERCHANT" : "GLOBAL",
      totalTransactions,
      byStatus: toStatusCounts(all),
      payments: paymentStats,
      openReconciliationExceptions: openExceptions,
      reconciliation,
      demoDatasetLoadedAt: windowEnd?.toISOString() ?? null,
    };
  }

  /**
   * Formule et limites : ADR 0009. Deux COUNT en base sur la même fenêtre ; la
   * seule opération ici est la soustraction de deux entiers déjà comptés.
   */
  private async reconciliation(windowStart: Date, windowEnd: Date): Promise<ReconciliationStatsDto> {
    const inWindowAndSettled = {
      createdAt: { gte: windowStart, lte: windowEnd },
      status: { notIn: IN_PROGRESS_STATUSES },
    };
    const [settled, withOpenException] = await Promise.all([
      this.prisma.client.transaction.count({ where: inWindowAndSettled }),
      this.prisma.client.transaction.count({
        where: { ...inWindowAndSettled, reconciliationExceptions: { some: { resolvedAt: null } } },
      }),
    ]);
    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      settledTransactions: settled,
      reconciledTransactions: settled - withOpenException,
    };
  }
}
