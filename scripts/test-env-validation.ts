import "reflect-metadata";
import assert from "node:assert/strict";
import { validate } from "../src/config/env.validation";

/**
 * Régression ciblée : sous tsx/esbuild (comment ce fichier s'exécute),
 * `emitDecoratorMetadata` n'est pas émis — contrairement à `tsc`, qui
 * compile l'API elle-même. `plainToInstance(..., { enableImplicitConversion: true })`
 * devine le type cible depuis cette métadonnée absente ; sans @Type(), une
 * variable numérique comme PORT reste une chaîne et @IsInt() la rejette
 * ("PORT must be an integer number") — exactement le bug constaté en
 * production (Railway, scripts/seed-demo.ts via tsx).
 *
 * Un test équivalent sous ts-jest ne le détecterait PAS : ts-jest utilise
 * le compilateur tsc, qui émet cette métadonnée normalement. Seule une
 * exécution via tsx reproduit les conditions réelles du bug.
 */

const BASE_ENV = {
  APP_DATABASE_URL: "postgresql://ledger_app:x@localhost:5432/ledger",
};

function expectValid(label: string, env: Record<string, string>): void {
  const result = validate({ ...BASE_ENV, ...env });
  console.log(`OK    ${label}`);
  void result;
}

function expectInvalid(label: string, env: Record<string, string>): void {
  assert.throws(() => validate({ ...BASE_ENV, ...env }), `ÉCHEC ${label} : aucune erreur levée`);
  console.log(`OK    ${label}`);
}

// Le cas exact du bug de production : PORT="3000" (chaîne, comme tout ce que
// Railway injecte) doit être accepté ET converti en nombre réel.
const validated = validate({ ...BASE_ENV, PORT: "3000" });
assert.equal(validated.PORT, 3000, "PORT doit être converti en nombre (3000), pas rester la chaîne \"3000\"");
assert.equal(typeof validated.PORT, "number", "typeof PORT doit être \"number\" après validation");
console.log('OK    PORT="3000" accepté et converti en nombre 3000');

expectValid("DATABASE_POOL_MAX=\"5\" accepté", { DATABASE_POOL_MAX: "5" });
expectValid("PAYMENT_EXPIRY_MINUTES_DEFAULT=\"15\" accepté", { PAYMENT_EXPIRY_MINUTES_DEFAULT: "15" });

// La validation ne doit pas être devenue un simple passe-plat : une valeur
// réellement invalide doit toujours être rejetée.
expectInvalid("PORT=\"70000\" (hors plage) toujours rejeté", { PORT: "70000" });
expectInvalid("PORT=\"pas-un-nombre\" toujours rejeté", { PORT: "pas-un-nombre" });

console.log("");
console.log("Tous les tests de validation d'environnement (sous tsx) sont passés.");
