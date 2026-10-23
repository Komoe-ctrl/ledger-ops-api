import "reflect-metadata";
import { validate } from "../src/config/env.validation";

/**
 * Valide les variables d'environnement SANS bootstrapper de contexte Nest —
 * juste la fonction pure, exactement celle que ConfigModule.forRoot()
 * appelle au démarrage réel. Pensé pour tourner en tête de `demo:reset`,
 * AVANT le TRUNCATE : si l'environnement est invalide, on le découvre avant
 * de vider la base, pas après (le seed qui suit le TRUNCATE échouerait de
 * toute façon, mais trop tard — la démo resterait vide jusqu'au prochain
 * cycle, sans qu'aucune donnée ne soit récupérable entre les deux).
 */
function main(): void {
  try {
    validate(process.env);
    console.log("Variables d'environnement valides.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
