/** @type {import('jest').Config} */
module.exports = {
  rootDir: "../..",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/e2e/**/*.e2e-spec.ts"],
  transform: { "^.+\\.ts$": "ts-jest" },
  globalSetup: "<rootDir>/test/e2e/global-setup.ts",
  globalTeardown: "<rootDir>/test/e2e/global-teardown.ts",
  testTimeout: 30000,
  // Un seul conteneur Postgres pour toute la suite (voir global-setup) :
  // en série, pas de contention de connexions ni d'interférence entre
  // fichiers de test qui partageraient par erreur des données.
  maxWorkers: 1,
};
