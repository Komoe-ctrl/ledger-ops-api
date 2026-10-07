# ledger-ops-api

API du back-office **ledger-ops** : opérations de paiement mobile money (Orange Money, MTN MoMo, Wave, Moov — simulés) avec grand livre en partie double, machine à états des transactions, rapprochement avec les relevés opérateurs et journal d'audit infalsifiable.

Frontend : [ledger-ops-web](../ledger-ops-web) — il consomme cette API via son contrat OpenAPI.

## Démo publique

- API : `TODO — URL une fois déployée`
- Documentation interactive (Swagger) : `TODO/docs`
- Clé API `MERCHANT` (créer des paiements) : `TODO`
- Clé API `ANALYST` (lire le rapprochement) : `TODO`

La base se remet à zéro chaque nuit (voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)),
mais les clés ci-dessus restent **stables** d'une remise à zéro à l'autre
(`DEMO_MERCHANT_API_KEY`/`DEMO_ANALYST_API_KEY` fixées sur le service de
maintenance — voir `scripts/seed-demo.ts`) : pas besoin de revenir ici après
chaque nuit. Aucune clé `ADMIN` n'existe sur cette instance — c'est volontaire
(voir ADR 0003 et `docs/DEPLOIEMENT.md`).

## Stack
NestJS · TypeScript strict · PostgreSQL 17 · Prisma 7 · Redis 7 / BullMQ · Jest + Testcontainers

## Démarrage
```bash
cp .env.example .env
npm install
npm run db:up                    # PostgreSQL + Redis (Docker)
npm run db:migrate               # applique les migrations (crée aussi le rôle ledger_app, ADR 0003)
npm run db:test:integrity        # vérifie les règles d'intégrité (base vide)
npm run db:test:least-privilege  # vérifie les privilèges du rôle applicatif (base vide)
npm run bootstrap:admin-key      # émet la première clé ADMIN (idempotent)
npm run start:dev                # démarre l'API (http://localhost:3000, /docs pour Swagger)
```

## Jeu de données de démonstration
```bash
npm run seed:demo
```
Remplit la base avec une activité crédible : 3 marchands, ~70 paiements répartis sur les 4 opérateurs (majorité `SUCCEEDED`, quelques `FAILED`/`EXPIRED`, 2-3 `PENDING` en cours), 2 remboursements, 1 litige perdu, et les 4 types d'exceptions de rapprochement (ADR 0007/0008). À la fin, le script affiche les clés API de démo en clair (une seule fois, jamais récupérables ensuite) et vérifie lui-même que le grand livre reste équilibré.

- **Sûr à ré-exécuter sans reset** : chaque transaction a une clé d'idempotence déterministe, les clés API de démo sont révoquées puis réémises à chaque run (jamais accumulées).
- **Aucun raccourci** : passe exclusivement par les services applicatifs (`PaymentsService`, `TransactionsService`, `ReconciliationService`...), jamais par un INSERT direct — les données produites suivent les mêmes règles qu'un vrai paiement.
- `created_at` reste toujours l'heure réelle d'exécution (imposé par la base, ADR 0003) : le script ne fabrique pas une fausse journée passée, il produit une activité récente et réelle. D'où la ligne finale `"Jeu de démonstration chargé le <horodatage>"`, pas une "activité du jour" fictive.
- En production, ce script tourne après un reset complet (tâche planifiée) — pas de rôle ADMIN dans sa sortie : une démo publique ne doit exposer que des clés `MERCHANT`/`ANALYST`.

## Déploiement

Railway, PostgreSQL managé, une image Docker (`Dockerfile`, racine du repo) partagée
entre deux services distincts — un service public sans jamais le rôle propriétaire de
la base dans son environnement, un service interne pour les migrations et la remise à
zéro nocturne. Procédure complète, variables d'environnement par service et
justification du découpage : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Structure
```
prisma/            schéma + migrations (dont les règles d'intégrité en SQL)
src/database/      client Prisma, withActor(), codes d'erreur LX0xx
scripts/           bootstrap admin, seed de démo, remise à zéro (hors HTTP ou en SQL direct)
test/              tests d'intégrité + privilèges SQL, suite e2e (Jest + Testcontainers)
docs/adr/          décisions d'architecture
docs/DEPLOIEMENT.md  procédure de déploiement (Railway)
```

## Feuille de route
1. Grand livre en partie double et règles d'intégrité en base — terminé
2. Paiements : API, machine à états, idempotence, écritures comptables — terminé
3. Remboursements, litiges, expiration automatique, simulateur opérateur — terminé
4. Authentification par clés API, rôles (RBAC), rôle PostgreSQL à privilèges minimaux — terminé
5. Jeu de données de démonstration, mise en ligne (Docker, CORS, rate limiting, documentation) — terminé, en attente du premier déploiement réel pour remplir les URLs/clés ci-dessus

## Décisions d'architecture
- [0001 — Grand livre en partie double](docs/adr/0001-grand-livre-partie-double.md)
- [0002 — Montants en entiers](docs/adr/0002-montants-en-entiers.md)
- [0003 — Intégrité en base](docs/adr/0003-integrite-en-base.md)
- [0004 — Commission, arrondi](docs/adr/0004-commission-arrondi.md)
- [0005 — Comptabilisation des remboursements](docs/adr/0005-remboursements-comptabilisation.md)
- [0006 — Comptabilisation d'un litige perdu](docs/adr/0006-litige-perdu-comptabilisation.md)
- [0007 — Acquittement opérateur tardif](docs/adr/0007-acquittement-tardif.md)
- [0008 — Types d'exceptions de rapprochement](docs/adr/0008-types-exceptions-rapprochement.md)
