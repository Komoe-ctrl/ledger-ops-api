import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * @Global() : évite de réimporter DatabaseModule dans chaque module métier
 * (TransactionsModule, etc.) pour obtenir PrismaService. Un seul import,
 * dans AppModule, suffit pour toute l'application.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
