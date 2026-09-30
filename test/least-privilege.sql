-- ============================================================================
-- Tests des privilèges du rôle applicatif "ledger_app" (ADR 0003, migration
-- least_privilege_app_role) — à exécuter sur une base migrée, EN TANT QUE
-- ledger_app (pas le rôle propriétaire) :
--   psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f test/least-privilege.sql
--
-- Garantie différente de test/integrity.sql : pas "le trigger bloque telle
-- opération" (déjà couvert, avec le rôle propriétaire) mais "le rôle
-- applicatif n'a même pas le droit d'essayer" — l'erreur attendue est 42501
-- (insufficient_privilege), levée par Postgres avant même que la ligne soit
-- localisée ou qu'un trigger ait la moindre chance de s'exécuter.
-- ============================================================================

\set QUIET on
\o /dev/null

CREATE FUNCTION pg_temp.expect_error(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_code THEN
      RAISE NOTICE 'OK    %  [%]', p_label, SQLSTATE;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ÉCHEC % : attendu %, obtenu % (%)', p_label, p_code, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'ÉCHEC % : aucune erreur levée (attendu %)', p_label, p_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- Positif : ce dont l'app a réellement besoin fonctionne. Si l'un de ces
-- ordres échoue, ON_ERROR_STOP arrête le script avec l'erreur psql brute —
-- pas besoin d'expect_error pour un cas qui doit réussir.
-- ---------------------------------------------------------------------------
-- BEGIN/COMMIT explicite : set_config(..., true) est local À LA TRANSACTION
-- — en autocommit (une transaction implicite par instruction), il serait
-- réinitialisé avant même l'INSERT suivant (LX007, "acteur non déclaré").
BEGIN;
SELECT set_config('app.actor_type', 'SYSTEM', true), set_config('app.actor_id', 'test-least-privilege', true);

INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, merchant_id, idempotency_key, request_fingerprint)
SELECT 'TXN-LP-0001', 'PAYMENT', 'ORANGE_MONEY', 5000, 'XOF', '+2250700000009', id, 'idem-lp-0001', repeat('c', 64)
FROM merchants WHERE code = 'demo';

UPDATE transactions SET status = 'FAILED' WHERE reference = 'TXN-LP-0001';

WITH e AS (
  INSERT INTO journal_entries (description, transaction_id)
  SELECT 'Test least-privilege', id FROM transactions WHERE reference = 'TXN-LP-0001'
  RETURNING id
)
INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
SELECT e.id, a.id, v.direction::"EntryDirection", v.amount, 'XOF'
FROM e,
     (VALUES ('provider:orange_money:clearing', 'DEBIT',  5000),
             ('merchant:demo:payable',          'CREDIT', 5000)) AS v(code, direction, amount)
JOIN ledger_accounts a ON a.code = v.code;
COMMIT;

-- Les deux vues de lecture (init_ledger) : une vue vérifie le privilège
-- SELECT sur ELLE-MÊME, pas seulement sur les tables sous-jacentes — un
-- GRANT sur les tables ne suffit pas. Oublié une première fois par la
-- migration least_privilege_app_role, découvert en faisant vérifier
-- l'équilibre du grand livre par le seed de démo (jalon 5).
SELECT count(*) FROM v_account_balances;
SELECT count(*) FROM v_trial_balance_violations;

-- ---------------------------------------------------------------------------
-- Négatif : tout ce que l'app n'a jamais besoin de faire doit être refusé
-- au niveau du privilège, avant même d'atteindre un trigger. `WHERE false`
-- : le refus doit se produire même quand aucune ligne ne serait touchée —
-- Postgres vérifie le privilège avant d'évaluer les lignes concernées.
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_error('modifier une écriture (journal_entries)',
  $q$ UPDATE journal_entries SET description = 'x' WHERE false $q$, '42501');

SELECT pg_temp.expect_error('supprimer une ligne d''écriture (ledger_postings)',
  $q$ DELETE FROM ledger_postings WHERE false $q$, '42501');

SELECT pg_temp.expect_error('modifier l''historique de statuts',
  $q$ UPDATE transaction_status_history SET reason = 'x' WHERE false $q$, '42501');

SELECT pg_temp.expect_error('écrire dans le référentiel de transitions',
  $q$ INSERT INTO transaction_status_transitions (from_status, to_status) VALUES ('PENDING', 'PENDING') $q$, '42501');

SELECT pg_temp.expect_error('modifier un compte comptable',
  $q$ UPDATE ledger_accounts SET name = 'x' WHERE false $q$, '42501');

SELECT pg_temp.expect_error('modifier un marchand (aucun endpoint ne le fait encore)',
  $q$ UPDATE merchants SET name = 'x' WHERE false $q$, '42501');

SELECT pg_temp.expect_error('supprimer une transaction',
  $q$ DELETE FROM transactions WHERE false $q$, '42501');

SELECT pg_temp.expect_error('TRUNCATE sur une table comptable',
  $q$ TRUNCATE transactions $q$, '42501');

SELECT pg_temp.expect_error('créer une table (aucun DDL pour ce rôle)',
  $q$ CREATE TABLE public.probe_least_privilege (id int) $q$, '42501');

\echo ''
\echo 'Tous les tests de privilèges (ledger_app) sont passés.'
