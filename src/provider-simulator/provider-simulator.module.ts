import { BullModule } from "@nestjs/bullmq";
import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";
import { TransactionsModule } from "../transactions/transactions.module";
import { OPERATOR_CALLBACKS_QUEUE, OperatorSimulatorProducer } from "./provider-simulator.producer";
import { OperatorSimulatorProcessor } from "./provider-simulator.processor";

/**
 * @Global() comme CommonModule/DatabaseModule : PaymentsService injecte
 * OperatorSimulatorProducer en @Optional() (voir payments.service.ts).
 * Ce module n'est chargé du tout que si PROVIDER_SIMULATOR_ENABLED=true
 * (voir ConditionalModule dans app.module.ts) — quand il ne l'est pas,
 * ni Redis ni cette classe n'existent, l'injection optionnelle résout
 * simplement à `undefined`.
 */
@Global()
@Module({
  imports: [
    TransactionsModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // maxRetriesPerRequest: null est exigé par BullMQ pour la connexion
        // utilisée par un worker (commandes bloquantes) — pas une option
        // arbitraire.
        connection: new Redis(config.getOrThrow<string>("REDIS_URL"), { maxRetriesPerRequest: null }),
      }),
    }),
    BullModule.registerQueue({ name: OPERATOR_CALLBACKS_QUEUE }),
  ],
  providers: [OperatorSimulatorProducer, OperatorSimulatorProcessor],
  exports: [OperatorSimulatorProducer],
})
export class ProviderSimulatorModule {}
