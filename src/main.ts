import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./app.config";
import { resolveCorsOrigins } from "./config/cors.util";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Le front (Vercel) appelle cette API depuis un domaine différent — en
  // développement local, pas de restriction (voir resolveCorsOrigins).
  app.enableCors({ origin: resolveCorsOrigins(process.env.CORS_ALLOWED_ORIGINS) });

  // Contrat de référence pour la génération de types côté front, et
  // documentation interactive de la démo — volontairement public (voir
  // docs/DEPLOIEMENT.md), aucune garde sur /docs. addBearerAuth() fait
  // apparaître le bouton "Authorize" : coller une clé API de démo y suffit
  // pour que les routes marquées @ApiBearerAuth() l'envoient automatiquement.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("ledger-ops API")
    .setDescription("Grand livre en partie double, transactions mobile money, rapprochement, audit.")
    .setVersion("0.1.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      // bearerFormat par défaut à "JWT" côté @nestjs/swagger — purement
      // informatif, ne change rien à l'UI "Authorize" (un simple champ
      // texte) ; la description ci-dessous suffit à clarifier.
      description: "Clé API en clair (jamais un JWT) — voir POST /v1/api-keys ou scripts/seed-demo.ts.",
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
