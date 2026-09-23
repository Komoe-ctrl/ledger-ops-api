import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { validate } from "./config/env.validation";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { PaymentsModule } from "./payments/payments.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { ExpirationModule } from "./expiration/expiration.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    HealthModule,
    PaymentsModule,
    TransactionsModule,
    ExpirationModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
