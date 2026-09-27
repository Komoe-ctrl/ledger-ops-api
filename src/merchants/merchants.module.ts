import { Module } from "@nestjs/common";
import { MerchantsService } from "./merchants.service";

// Pas de contrôleur encore : sera exposé (admin-only) à l'étape 5, une fois
// l'authentification en place. Pour l'instant, MerchantsService est
// disponible en injection pour les étapes suivantes (2 : merchantId sur
// Transaction) et testable directement.
@Module({
  providers: [MerchantsService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
