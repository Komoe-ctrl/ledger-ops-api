import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ProblemDetailsFilter } from "./common/filters/problem-details.filter";

/**
 * Pipes/filtres globaux, partagés entre le vrai bootstrap (main.ts) et les
 * tests e2e. Un `Test.createTestingModule(...).compile()` ne rejoue PAS
 * ce que fait main.ts — sans cette fonction commune, les tests e2e
 * tourneraient sans ValidationPipe ni filtre d'erreurs, et vérifieraient
 * autre chose que ce qui tourne réellement en prod.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
