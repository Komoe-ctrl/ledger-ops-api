-- ============================================================================
-- reset-demo-data.sql
--
-- Remise à zéro des DONNÉES de la démo publique — jamais du schéma. Pensé
-- pour tourner chaque nuit (tâche planifiée, service Railway dédié), à la
-- place d'un `prisma migrate reset` : rejouer tout l'historique de
-- migrations chaque nuit est lent et fragile (une migration qui échoue tue
-- la démo sans personne pour le remarquer avant le lendemain).
--
-- À exécuter avec le rôle PROPRIÉTAIRE (DATABASE_URL), jamais ledger_app :
-- ALTER TABLE ... DISABLE TRIGGER exige d'être propriétaire de la table, et
-- c'est précisément ce que ledger_app ne doit jamais pouvoir faire (ADR 0003).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reset-demo-data.sql
--
-- Les triggers d'ajout seul (fn_forbid_mutation, BEFORE TRUNCATE) bloquent
-- délibérément TRUNCATE en usage normal — ADR 0003 ne prévoit pas
-- d'exception. Ici, c'est une opération de maintenance déclarée, désactivée
-- pour la durée du TRUNCATE puis immédiatement réactivée dans la même
-- transaction : jamais un contournement permanent.
-- ============================================================================

BEGIN;

ALTER TABLE "reconciliation_exceptions"     DISABLE TRIGGER ALL;
ALTER TABLE "ledger_postings"               DISABLE TRIGGER ALL;
ALTER TABLE "journal_entries"               DISABLE TRIGGER ALL;
ALTER TABLE "transaction_status_history"    DISABLE TRIGGER ALL;
ALTER TABLE "transactions"                  DISABLE TRIGGER ALL;
ALTER TABLE "api_keys"                      DISABLE TRIGGER ALL;
ALTER TABLE "merchants"                     DISABLE TRIGGER ALL;
ALTER TABLE "ledger_accounts"               DISABLE TRIGGER ALL;

-- CASCADE : sans effet aujourd'hui (les 8 tables listées couvrent déjà tout
-- le graphe de dépendances — aucune autre table ne référence l'une
-- d'elles), gardé pour ne pas casser silencieusement si une migration
-- future ajoute une table dépendante qu'on aurait oublié d'ajouter ici.
-- RESTART IDENTITY : sans effet non plus (aucune colonne serial/identity —
-- tous les id sont des UUID générés par gen_random_uuid()), gardé pour
-- rester explicite sur l'intention plutôt que de laisser deviner.
TRUNCATE TABLE
  "reconciliation_exceptions",
  "ledger_postings",
  "journal_entries",
  "transaction_status_history",
  "transactions",
  "api_keys",
  "merchants",
  "ledger_accounts"
RESTART IDENTITY CASCADE;

ALTER TABLE "reconciliation_exceptions"     ENABLE TRIGGER ALL;
ALTER TABLE "ledger_postings"               ENABLE TRIGGER ALL;
ALTER TABLE "journal_entries"               ENABLE TRIGGER ALL;
ALTER TABLE "transaction_status_history"    ENABLE TRIGGER ALL;
ALTER TABLE "transactions"                  ENABLE TRIGGER ALL;
ALTER TABLE "api_keys"                      ENABLE TRIGGER ALL;
ALTER TABLE "merchants"                     ENABLE TRIGGER ALL;
ALTER TABLE "ledger_accounts"               ENABLE TRIGGER ALL;

-- Réinsertion du plan comptable de base — miroir exact de la migration
-- seed_chart_of_accounts (jalon 1). Après ce script, l'état de la base doit
-- être indiscernable d'une base fraîchement migrée, jamais un état appauvri.
INSERT INTO "ledger_accounts" ("code", "name", "type", "currency") VALUES
  ('provider:orange_money:clearing', 'Créance Orange Money',  'ASSET',     'XOF'),
  ('provider:mtn_momo:clearing',     'Créance MTN MoMo',      'ASSET',     'XOF'),
  ('provider:wave:clearing',         'Créance Wave',          'ASSET',     'XOF'),
  ('provider:moov_money:clearing',   'Créance Moov Money',    'ASSET',     'XOF'),
  ('merchant:demo:payable',          'Dû au marchand démo',   'LIABILITY', 'XOF'),
  ('revenue:fees',                   'Commissions',           'REVENUE',   'XOF');

-- Réinsertion du marchand démo — miroir exact de la migration merchants
-- (jalon 4, étape 1). Non utilisé par seed-demo.ts (qui crée ses propres
-- marchands), gardé pour la même raison : ne jamais diverger de ce qu'une
-- vraie migration produirait.
INSERT INTO "merchants" ("code", "name") VALUES ('demo', 'Marchand démo');

COMMIT;
