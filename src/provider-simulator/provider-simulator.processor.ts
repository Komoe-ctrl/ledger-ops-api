import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger, PreconditionFailedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Job } from "bullmq";
import { TransactionStatus } from "../database/prisma";
import { TransactionsService } from "../transactions/transactions.service";
import { OPERATOR_CALLBACKS_QUEUE } from "./provider-simulator.producer";

const DEFAULT_FAILURE_RATE_PERCENT = 10;

@Processor(OPERATOR_CALLBACKS_QUEUE)
export class OperatorSimulatorProcessor extends WorkerHost {
  private readonly logger = new Logger(OperatorSimulatorProcessor.name);

  constructor(
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<{ reference: string }>): Promise<void> {
    const { reference } = job.data;

    if (job.name === "acknowledge") {
      await this.transitionIfStillAt(reference, TransactionStatus.INITIATED, TransactionStatus.PENDING);
      return;
    }

    if (job.name === "settle") {
      const failureRate = this.config.get<number>("PROVIDER_SIMULATOR_FAILURE_RATE") ?? DEFAULT_FAILURE_RATE_PERCENT;
      const target = Math.random() * 100 < failureRate ? TransactionStatus.FAILED : TransactionStatus.SUCCEEDED;
      await this.transitionIfStillAt(reference, TransactionStatus.PENDING, target);
    }
  }

  /**
   * Un humain (ou n'importe quel autre appelant) peut avoir déjà fait
   * bouger la transaction entre-temps — un simulateur n'est jamais une
   * source de vérité, il ne doit jamais forcer un état. Statut de départ
   * relu juste avant d'agir ; s'il ne correspond plus, ou si on perd la
   * course sur la version (`PreconditionFailedException`), il n'y a
   * simplement plus rien à simuler ici.
   */
  private async transitionIfStillAt(
    reference: string,
    expectedFrom: TransactionStatus,
    to: TransactionStatus,
  ): Promise<void> {
    const current = await this.transactions.findByReferenceOrThrow(reference);
    if (current.status !== expectedFrom) {
      return;
    }

    try {
      await this.transactions.transition(reference, { status: to, reason: "Callback opérateur simulé" }, current.version);
    } catch (error) {
      if (error instanceof PreconditionFailedException) {
        return;
      }
      this.logger.warn(
        `Callback simulé ${reference} (${expectedFrom} -> ${to}) échoué : ${(error as Error).message}`,
      );
    }
  }
}
