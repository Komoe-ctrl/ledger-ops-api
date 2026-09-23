import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { TransactionsService } from "../transactions/transactions.service";

/**
 * Balayage en mémoire (@nestjs/schedule), pas BullMQ malgré Redis déjà
 * présent (CLAUDE.md, "Redis/BullMQ plus tard") : ce job n'a besoin
 * d'aucune garantie de file durable — retry, dead-letter, distribution
 * entre workers. Si l'API tournait un jour sur plusieurs instances, deux
 * balayages concurrents ne se marchent pas dessus : une transaction déjà
 * expirée par l'un échouerait juste proprement pour l'autre (elle ne
 * matcherait plus le WHERE). BullMQ reste pertinent pour un vrai besoin
 * de traitement asynchrone fiable — plausiblement le simulateur opérateur.
 */
@Injectable()
export class ExpirationScheduler {
  private readonly logger = new Logger(ExpirationScheduler.name);

  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiration(): Promise<void> {
    const count = await this.transactions.expireOverduePending();
    if (count > 0) {
      this.logger.log(`${count} transaction(s) expirée(s) automatiquement`);
    }
  }
}
