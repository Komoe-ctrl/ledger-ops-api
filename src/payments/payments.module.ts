import { Module } from "@nestjs/common";
import { MerchantsModule } from "../merchants/merchants.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [TransactionsModule, MerchantsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
