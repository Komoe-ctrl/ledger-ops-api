import { Module } from "@nestjs/common";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";
import { TransactionAuditService } from "./transaction-audit.service";

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionAuditService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
