import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

/**
 * 60 requêtes/minute par IP — une seule instance de démo publique, pas un
 * service multi-tenant à dimensionner. Regroupé en un seul module (plutôt
 * que ThrottlerModule + APP_GUARD séparément dans AppModule) pour pouvoir
 * désactiver les deux ensemble via ConditionalModule — sinon enregistrer
 * APP_GUARD sans ThrottlerModule planterait au démarrage (ThrottlerGuard ne
 * trouverait pas ses dépendances).
 */
@Module({
  imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 60 }])],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
