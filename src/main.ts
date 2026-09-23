import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { configureApp } from "./app.config";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Contrat de référence pour la génération de types côté front. Servi en
  // dev/jalon 2 ; à restreindre (auth) avant tout déploiement public.
  const swaggerConfig = new DocumentBuilder()
    .setTitle("ledger-ops API")
    .setDescription("Grand livre en partie double, transactions mobile money, rapprochement, audit.")
    .setVersion("0.1.0")
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, swaggerDocument);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
