import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { ProblemDetailsFilter } from "./common/filters/problem-details.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // supprime silencieusement les champs non déclarés dans le DTO
      forbidNonWhitelisted: true, // ... sauf ici : un champ inattendu devient une 400
      transform: true, // instancie la classe DTO (nécessaire pour que les décorateurs s'appliquent)
    }),
  );

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
