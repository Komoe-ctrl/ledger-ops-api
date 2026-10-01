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
import { RateLimitModule } from "./rate-limit/rate-limit.module";

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
    ReconciliationModule,
    // Activé par défaut (contrairement au simulateur) : c'est un
    // comportement de production normal, pas une dépendance optionnelle.
    // Désactivé explicitement par les tests e2e et les scripts one-shot
    // (bootstrap-admin-key, seed-demo), qui pilotent expireOverduePending()
    // eux-mêmes — sans ce drapeau, le vrai cron (toutes les minutes) tourne
    // en concurrence avec eux et peut faire échouer une transaction Prisma
    // en cours (P2028, "Unable to start a transaction in the given time") :
    // vraisemblablement la cause des échecs e2e intermittents jamais
    // expliqués jusqu'ici.
    ConditionalModule.registerWhen(
      ExpirationModule,
      (env: NodeJS.ProcessEnv) => env.EXPIRATION_CRON_ENABLED !== "false",
    ),
    // Redis n'est requis QUE si ce module est chargé — jamais en test e2e,
    // qui ne positionne pas ce drapeau et piloterait sinon des transitions
    // en concurrence imprévisible avec ce que le simulateur ferait.
    ConditionalModule.registerWhen(
      ProviderSimulatorModule,
      (env: NodeJS.ProcessEnv) => env.PROVIDER_SIMULATOR_ENABLED === "true",
    ),
    // Activé par défaut, comme le cron d'expiration. Désactivé en e2e (voir
    // global-setup.ts) : la suite tire des dizaines de requêtes en quelques
    // secondes (ex. le test "10 requêtes concurrentes"), largement de quoi
    // franchir une limite pensée pour un visiteur humain et rendre la suite
    // flaky pour une raison qui n'a rien à voir avec ce qu'elle teste.
    ConditionalModule.registerWhen(
      RateLimitModule,
      (env: NodeJS.ProcessEnv) => env.RATE_LIMIT_ENABLED !== "false",
    ),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
