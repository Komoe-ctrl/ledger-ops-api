import { Body, Controller, NotImplementedException, Post } from "@nestjs/common";
import { CreatePaymentDto } from "./dto/create-payment.dto";

@Controller("v1/payments")
export class PaymentsController {
  @Post()
  create(@Body() dto: CreatePaymentDto): never {
    // Corps validé (voir CreatePaymentDto). La création — clé d'idempotence,
    // empreinte, insertion en base — arrive à l'étape 6.
    throw new NotImplementedException({ received: dto });
  }
}
