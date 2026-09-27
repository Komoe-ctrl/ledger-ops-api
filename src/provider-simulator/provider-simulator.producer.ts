import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

export const OPERATOR_CALLBACKS_QUEUE = "operator-callbacks";

function randomDelayMs(minMs: number, maxMs: number): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

/**
 * Simule le comportement asynchrone réel d'un opérateur mobile money :
 * l'appel de création répond tout de suite (INITIATED), la confirmation
 * arrive plus tard, en deux temps (accusé de réception, puis règlement
 * final) — jamais synchrone. D'où BullMQ plutôt qu'un simple `setTimeout` :
 * un job planifié survit à un redémarrage de l'API, contrairement à un
 * minuteur en mémoire qui disparaîtrait avec le process.
 */
@Injectable()
export class OperatorSimulatorProducer {
  constructor(@InjectQueue(OPERATOR_CALLBACKS_QUEUE) private readonly queue: Queue) {}

  async scheduleCallbacks(reference: string): Promise<void> {
    const ackDelay = randomDelayMs(1_000, 3_000);
    const settleDelay = ackDelay + randomDelayMs(2_000, 6_000);

    await this.queue.add("acknowledge", { reference }, { delay: ackDelay });
    await this.queue.add("settle", { reference }, { delay: settleDelay });
  }
}
