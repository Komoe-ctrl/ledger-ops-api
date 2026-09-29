-- ============================================================================
-- least_privilege_app_role
--
-- ADR 0003 (dette explicite, notée dès le jalon 1) : le rôle propriétaire
-- des tables — celui qui exécute les migrations — ne doit jamais être celui
-- avec lequel l'API se connecte au runtime. Les triggers (LX001 et suite)
-- empêchent déjà UPDATE/DELETE sur les tables en ajout seul, mais ça reste
-- une garantie applicative : un GRANT qui n'existe pas ne dépend d'aucun
-- code, ne peut pas être contourné par un bug dans une fonction PL/pgSQL,
-- et protège même un accès direct à la base avec les identifiants de l'API.
--
-- CREATE ROLE est un objet de CLUSTER (pas de base) : le bloc DO / EXCEPTION
-- rend la création idempotente si cette migration est rejouée sur un
-- cluster qui héberge déjà ce rôle (ex. la base "shadow" utilisée par
-- `prisma migrate dev` partage le même cluster que la base de dev).
--
-- Mot de passe de développement uniquement, au même titre que le rôle
-- propriétaire "ledger" (voir docker-compose.yml) : à changer hors de toute
-- migration (ALTER ROLE ... PASSWORD) pour un environnement réel — jamais
-- en committant un vrai secret dans l'historique de migrations.
-- ============================================================================

DO $$
BEGIN
  CREATE ROLE "ledger_app" LOGIN PASSWORD 'ledger_app_dev_only';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA "public" TO "ledger_app";

-- Tables comptables en ajout seul : SELECT + INSERT, jamais UPDATE/DELETE.
-- Même liste que les triggers fn_forbid_mutation (migration init_ledger).
GRANT SELECT, INSERT ON
  "journal_entries",
  "ledger_postings",
  "transaction_status_history"
TO "ledger_app";

-- Référentiel des transitions de statut autorisées : jamais écrit par
-- l'API, seulement par les migrations (jalon 1). Lecture seule ici.
GRANT SELECT ON "transaction_status_transitions" TO "ledger_app";

-- Comptes comptables : créés par l'app (un par marchand, jalon 4 étape 1),
-- jamais modifiés ni supprimés — aucun chemin de code n'appelle UPDATE ici.
GRANT SELECT, INSERT ON "ledger_accounts" TO "ledger_app";

-- Marchands : créés par l'app (admin), jamais modifiés depuis le code
-- actuel (name/is_active resteraient modifiables côté trigger le jour où un
-- endpoint d'édition existera — ce jour-là, cette migration-ci n'a pas à
-- être réécrite : une nouvelle migration ajoutera le GRANT UPDATE alors).
GRANT SELECT, INSERT ON "merchants" TO "ledger_app";

-- Transactions : seule table métier qui a un vrai cycle de vie (statut,
-- version, refunded_amount) — UPDATE nécessaire, DELETE jamais.
GRANT SELECT, INSERT, UPDATE ON "transactions" TO "ledger_app";

-- Clés API : émission (INSERT) et révocation (UPDATE is_active/revoked_at)
-- par l'app — jamais de suppression, la révocation est la seule sortie.
GRANT SELECT, INSERT, UPDATE ON "api_keys" TO "ledger_app";

-- Exceptions de rapprochement : créées à la détection (INSERT), closes par
-- un analyste (UPDATE resolved_*) — jamais supprimées (ADR 0007).
GRANT SELECT, INSERT, UPDATE ON "reconciliation_exceptions" TO "ledger_app";
