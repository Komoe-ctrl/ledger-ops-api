# ledger-ops-api — Contexte pour Claude Code

## Le projet
API de back-office de paiement mobile money (Orange Money, MTN MoMo, Wave, Moov, simulés) :
grand livre en partie double, machine à états des transactions, rapprochement avec les relevés
opérateurs, journal d'audit infalsifiable. Projet de portfolio, niveau exigé : production.

Stack : NestJS, TypeScript strict, PostgreSQL 17, Prisma 7 (générateur `prisma-client`,
moduleFormat cjs, driver adapter `@prisma/adapter-pg`), Redis/BullMQ (plus tard), Jest.

## Ce qui existe (jalon 1, terminé)
- `prisma/schema.prisma` : structure des tables.
- `prisma/migrations/.../migration.sql` : les RÈGLES D'INTÉGRITÉ sont en SQL (triggers,
  contraintes). Lire la partie 2 et `docs/adr/0003-integrite-en-base.md` avant toute chose.
- Erreurs métier levées par la base : codes `LX001` à `LX010`, préfixés dans le message.
- `src/database/prisma.ts` : `withActor()` = seule porte d'entrée pour toute écriture
  qui touche l'argent ou un statut (déclare l'acteur, lu par les triggers).
- `test/integrity.sql` : 24 tests d'intégrité qui doivent toujours passer.

## Règles techniques non négociables
- Montants : `bigint` en TypeScript, jamais `number`. Sérialisés en chaîne dans le JSON.
- Aucune écriture comptable ne se modifie : correction = contre-écriture.
- Ne jamais affaiblir ou contourner une règle SQL existante pour « faire passer » du code.
- Toute écriture passe par `withActor()`.
- Tests contre un vrai PostgreSQL, jamais contre un mock de la base.
- Commits au format Conventional Commits (feat, fix, test, docs, chore, refactor).

## Mode de travail
Le mode mentor est LEVÉ (décision du 2026-10-23), pour tout le dépôt, API comprise. Je relis le
travail en pull request : tu codes directement, sans découper en étapes pédagogiques et sans
attendre ma validation à chaque choix.

Ce qui reste attendu :
1. Réponds en français.
2. Une branche et une PR par fonctionnalité (jamais de commit direct sur `main`) ; c'est moi qui
   fusionne. Commits au format Conventional Commits.
3. API : tests e2e écrits avec le code, contre un vrai PostgreSQL (règle ci-dessus). Front
   (ledger-ops-web) : tests différés, je te dirai quand les ajouter.
4. Dis ce que tu as vérifié et comment, et surtout ce que tu n'as PAS pu vérifier.
5. Décision d'architecture non triviale (définition d'une métrique, compromis d'intégrité) :
   un ADR dans `docs/adr/`.
6. Signale les écarts avec ce qui a été demandé plutôt que de les absorber en silence.
