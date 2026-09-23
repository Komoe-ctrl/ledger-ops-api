import { Module } from "@nestjs/common";
import { TransactionsModule } from "../transactions/transactions.module";
import { ExpirationScheduler } from "./expiration.scheduler";

@Module({
  imports: [TransactionsModule],
  providers: [ExpirationScheduler],
})
export class ExpirationModule {}
