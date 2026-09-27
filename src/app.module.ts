import { Module } from "@nestjs/common";
import { ConditionalModule, ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { validate } from "./config/env.validation";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { MerchantsModule } from "./merchants/merchants.module";
import { PaymentsModule } from "./payments/payments.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { ExpirationModule } from "./expiration/expiration.module";
import { ReconciliationModule } from "./reconciliation/reconciliation.module";
import { ProviderSimulatorModule } from "./provider-simulator/provider-simulator.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    AuthModule,
    DatabaseModule,
    HealthModule,
    MerchantsModule,
    PaymentsModule,
    TransactionsModule,
    ExpirationModule,
    ReconciliationModule,
    // Redis n'est requis QUE si ce module est chargé — jamais en test e2e,
    // qui ne positionne pas ce drapeau et piloterait sinon des transitions
    // en concurrence imprévisible avec ce que le simulateur ferait.
    ConditionalModule.registerWhen(
      ProviderSimulatorModule,
      (env: NodeJS.ProcessEnv) => env.PROVIDER_SIMULATOR_ENABLED === "true",
    ),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
