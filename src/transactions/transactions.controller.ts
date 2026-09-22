import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { ListTransactionsQueryDto } from "./dto/list-transactions.query.dto";
import { TransactionsService } from "./transactions.service";
import { toHistoryResponse, toTransactionResponse } from "./transaction.presenter";

@Controller("v1/transactions")
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Get()
  async list(@Query() query: ListTransactionsQueryDto) {
    const { data, nextCursor } = await this.transactions.list(query);
    return { data: data.map(toTransactionResponse), nextCursor };
  }

  @Get(":reference")
  async getOne(@Param("reference") reference: string) {
    const transaction = await this.transactions.findByReferenceOrThrow(reference);
    return toTransactionResponse(transaction);
  }

  @Get(":reference/history")
  async getHistory(@Param("reference") reference: string) {
    const history = await this.transactions.history(reference);
    return history.map(toHistoryResponse);
  }
}
