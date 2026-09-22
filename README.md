# ledger-ops-api

API du back-office **ledger-ops** : opérations de paiement mobile money (Orange Money, MTN MoMo, Wave, Moov — simulés) avec grand livre en partie double, machine à états des transactions, rapprochement avec les relevés opérateurs et journal d'audit infalsifiable.

Frontend : [ledger-ops-web](../ledger-ops-web) — il consomme cette API via son contrat OpenAPI.

## Stack
NestJS · TypeScript strict · PostgreSQL 17 · Prisma 7 · Redis 7 / BullMQ · Jest + Testcontainers

## Démarrage
```bash
cp .env.example .env
npm install
npm run db:up               # PostgreSQL + Redis (Docker)
npm run db:migrate          # applique les migrations
npm run db:test:integrity   # vérifie les règles d'intégrité (base vide)
```

## Structure
```
prisma/            schéma + migrations (dont les règles d'intégrité en SQL)
src/database/      client Prisma, withActor(), codes d'erreur LX0xx
test/              tests d'intégrité SQL (puis Jest + Testcontainers)
docs/adr/          décisions d'architecture
```

## Feuille de route
1. **Grand livre et modèle de données** ← en cours
2. Transactions : API, machine à états, idempotence
3. Simulateur opérateur et moteur de rapprochement
4. Journal d'audit chaîné (SHA-256), rôles, tableau de bord

## Décisions d'architecture
- [0001 — Grand livre en partie double](docs/adr/0001-grand-livre-partie-double.md)
- [0002 — Montants en entiers](docs/adr/0002-montants-en-entiers.md)
- [0003 — Intégrité en base](docs/adr/0003-integrite-en-base.md)
