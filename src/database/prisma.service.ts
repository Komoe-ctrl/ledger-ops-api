import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPrismaClient, PrismaClient } from "./prisma";

/**
 * Câble le client Prisma (avec driver adapter, voir prisma.ts) sur le cycle
 * de vie NestJS : connexion explicite à `onModuleInit`, fermeture propre à
 * `onModuleDestroy` (sinon le process ne libère jamais le pool de connexions
 * en shutdown, ex. lors des tests e2e qui démarrent/arrêtent l'app en boucle).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  // @Inject explicite : ConfigService n'est utilisé ici que comme type, jamais
  // comme valeur. Sous tsx/esbuild (dev), l'import peut être élagué et casser
  // la métadonnée `design:paramtypes` que Nest lit pour deviner quoi injecter.
  // @Inject fixe le token indépendamment de cette réflexion.
  constructor(@Inject(ConfigService) config: ConfigService) {
    // APP_DATABASE_URL, jamais DATABASE_URL : le rôle propriétaire ne se
    // connecte qu'au moment des migrations (voir ADR 0003 et la migration
    // least_privilege_app_role) — l'API tourne toujours avec le rôle à
    // privilèges minimaux.
    this.client = createPrismaClient(config.getOrThrow<string>("APP_DATABASE_URL"));
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log("Connexion PostgreSQL établie");
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
