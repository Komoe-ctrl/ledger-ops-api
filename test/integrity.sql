-- ============================================================================
-- Tests d'intégrité du grand livre — à exécuter sur une base migrée et VIDE.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/integrity.sql
-- Chaque cas négatif vérifie le SQLSTATE exact (LX0xx), pas juste "une erreur".
-- Ces tests seront repris en Jest + Testcontainers au jalon suivant.
-- ============================================================================

\set QUIET on
-- Résultats de requêtes masqués : seuls les NOTICE (OK / ÉCHEC) s'affichent.
\o /dev/null

-- Utilitaire : exécute du SQL, force les contraintes différées, exige l'erreur attendue.
CREATE FUNCTION pg_temp.expect_error(p_label text, p_sql text, p_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
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
-- Plan comptable minimal (XOF)
-- ---------------------------------------------------------------------------
INSERT INTO ledger_accounts (code, name, type, currency) VALUES
  ('provider:orange_money:clearing', 'Créance Orange Money',   'ASSET',     'XOF'),
  ('merchant:demo:payable',          'Dû au marchand démo',    'LIABILITY', 'XOF'),
  ('revenue:fees',                   'Commissions',            'REVENUE',   'XOF'),
  ('provider:usd:test',              'Compte test USD',        'ASSET',     'USD');

-- ---------------------------------------------------------------------------
-- CAS NOMINAL : paiement de 10 000 XOF, commission 150 XOF
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('app.actor_type', 'SYSTEM', true), set_config('app.actor_id', 'test-suite', true);

INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, idempotency_key, request_fingerprint)
VALUES ('TXN-TEST-0001', 'PAYMENT', 'ORANGE_MONEY', 10000, 'XOF', '+2250700000001', 'idem-0001', repeat('a', 64));

UPDATE transactions SET status = 'PENDING' WHERE reference = 'TXN-TEST-0001';
UPDATE transactions SET status = 'SUCCEEDED', provider_reference = 'OM-998877' WHERE reference = 'TXN-TEST-0001';

WITH e AS (
  INSERT INTO journal_entries (description, transaction_id)
  SELECT 'Paiement TXN-TEST-0001', id FROM transactions WHERE reference = 'TXN-TEST-0001'
  RETURNING id
)
INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
SELECT e.id, a.id, v.direction::"EntryDirection", v.amount, 'XOF'
FROM e,
     (VALUES ('provider:orange_money:clearing', 'DEBIT',  10000),
             ('merchant:demo:payable',          'CREDIT',  9850),
             ('revenue:fees',                   'CREDIT',   150)) AS v(code, direction, amount)
JOIN ledger_accounts a ON a.code = v.code;
COMMIT;

DO $$
DECLARE v_hist int; v_version int;
BEGIN
  SELECT count(*) INTO v_hist FROM transaction_status_history h
    JOIN transactions t ON t.id = h.transaction_id WHERE t.reference = 'TXN-TEST-0001';
  SELECT version INTO v_version FROM transactions WHERE reference = 'TXN-TEST-0001';
  IF v_hist <> 3 THEN RAISE EXCEPTION 'ÉCHEC historique : 3 lignes attendues, % trouvées', v_hist; END IF;
  IF v_version <> 3 THEN RAISE EXCEPTION 'ÉCHEC version : 3 attendue, % trouvée', v_version; END IF;
  IF (SELECT balance FROM v_account_balances WHERE code = 'merchant:demo:payable') <> 9850 THEN
    RAISE EXCEPTION 'ÉCHEC solde marchand';
  END IF;
  RAISE NOTICE 'OK    paiement nominal : écriture équilibrée, 3 statuts historisés, version=3, solde marchand=9850';
END $$;

-- ---------------------------------------------------------------------------
-- CAS NÉGATIFS
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('app.actor_type', 'SYSTEM', true);

SELECT pg_temp.expect_error('écriture déséquilibrée',
  $q$ WITH e AS (INSERT INTO journal_entries (description) VALUES ('KO') RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, v.d::"EntryDirection", v.m, 'XOF' FROM e,
        (VALUES ('provider:orange_money:clearing','DEBIT',1000),('merchant:demo:payable','CREDIT',999)) v(c,d,m)
      JOIN ledger_accounts a ON a.code = v.c $q$, 'LX002');

SELECT pg_temp.expect_error('écriture sans ligne',
  $q$ INSERT INTO journal_entries (description) VALUES ('vide') $q$, 'LX002');

SELECT pg_temp.expect_error('écriture à une seule ligne',
  $q$ WITH e AS (INSERT INTO journal_entries (description) VALUES ('KO') RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, 'DEBIT', 500, 'XOF' FROM e JOIN ledger_accounts a ON a.code = 'revenue:fees' $q$, 'LX002');

SELECT pg_temp.expect_error('montant négatif ou nul',
  $q$ WITH e AS (INSERT INTO journal_entries (description) VALUES ('KO') RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, 'DEBIT', 0, 'XOF' FROM e JOIN ledger_accounts a ON a.code = 'revenue:fees' $q$, '23514');

SELECT pg_temp.expect_error('devise ligne ≠ devise compte',
  $q$ WITH e AS (INSERT INTO journal_entries (description) VALUES ('KO') RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, 'DEBIT', 500, 'USD' FROM e JOIN ledger_accounts a ON a.code = 'revenue:fees' $q$, 'LX003');

SELECT pg_temp.expect_error('écriture multi-devises',
  $q$ WITH e AS (INSERT INTO journal_entries (description) VALUES ('KO') RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, v.d::"EntryDirection", 500, a.currency FROM e,
        (VALUES ('provider:usd:test','DEBIT'),('revenue:fees','CREDIT')) v(c,d)
      JOIN ledger_accounts a ON a.code = v.c $q$, 'LX003');

SELECT pg_temp.expect_error('modifier une ligne comptable',
  $q$ UPDATE ledger_postings SET amount = amount + 1 $q$, 'LX001');

SELECT pg_temp.expect_error('supprimer une écriture',
  $q$ DELETE FROM journal_entries $q$, 'LX001');

SELECT pg_temp.expect_error('vider les lignes (TRUNCATE)',
  $q$ TRUNCATE ledger_postings CASCADE $q$, 'LX001');

SELECT pg_temp.expect_error('réécrire l''historique des statuts',
  $q$ UPDATE transaction_status_history SET to_status = 'FAILED' $q$, 'LX001');

SELECT pg_temp.expect_error('supprimer une transition de la machine à états',
  $q$ DELETE FROM transaction_status_transitions WHERE from_status = 'DISPUTED' $q$, 'LX001');

SELECT pg_temp.expect_error('transition interdite SUCCEEDED -> PENDING',
  $q$ UPDATE transactions SET status = 'PENDING' WHERE reference = 'TXN-TEST-0001' $q$, 'LX005');

SELECT pg_temp.expect_error('naître ailleurs qu''en INITIATED',
  $q$ INSERT INTO transactions (reference, type, status, provider, amount, currency, customer_msisdn, idempotency_key, request_fingerprint)
      VALUES ('TXN-KO', 'PAYMENT', 'SUCCEEDED', 'WAVE', 100, 'XOF', '+2250700000002', 'idem-ko', repeat('b',64)) $q$, 'LX005');

SELECT pg_temp.expect_error('modifier le montant d''une transaction',
  $q$ UPDATE transactions SET amount = 1 WHERE reference = 'TXN-TEST-0001' $q$, 'LX006');

SELECT pg_temp.expect_error('changer la référence opérateur posée',
  $q$ UPDATE transactions SET provider_reference = 'OM-FAKE' WHERE reference = 'TXN-TEST-0001' $q$, 'LX006');

SELECT pg_temp.expect_error('rejouer une clé d''idempotence',
  $q$ INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, idempotency_key, request_fingerprint)
      VALUES ('TXN-DUP', 'PAYMENT', 'WAVE', 100, 'XOF', '+2250700000002', 'idem-0001', repeat('c',64)) $q$, '23505');

SELECT pg_temp.expect_error('rembourser plus que le reste',
  $q$ INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, parent_transaction_id, idempotency_key, request_fingerprint)
      SELECT 'RFD-KO', 'REFUND', 'ORANGE_MONEY', 10001, 'XOF', '+2250700000001', id, 'idem-rfd-ko', repeat('d',64)
      FROM transactions WHERE reference = 'TXN-TEST-0001' $q$, 'LX010');

SELECT pg_temp.expect_error('statut REFUNDED sans remboursement complet',
  $q$ UPDATE transactions SET status = 'REFUNDED' WHERE reference = 'TXN-TEST-0001' $q$, '23514');

SELECT pg_temp.expect_error('numéro hors format E.164',
  $q$ INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, idempotency_key, request_fingerprint)
      VALUES ('TXN-MSISDN', 'PAYMENT', 'WAVE', 100, 'XOF', '0700000002', 'idem-msisdn', repeat('e',64)) $q$, '23514');

SELECT pg_temp.expect_error('contre-écriture non conforme',
  $q$ WITH e AS (
        INSERT INTO journal_entries (description, reverses_entry_id)
        SELECT 'Annulation bidon', id FROM journal_entries WHERE description = 'Paiement TXN-TEST-0001' RETURNING id)
      INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, v.d::"EntryDirection", v.m, 'XOF' FROM e,
        (VALUES ('merchant:demo:payable','DEBIT',100),('provider:orange_money:clearing','CREDIT',100)) v(c,d,m)
      JOIN ledger_accounts a ON a.code = v.c $q$, 'LX008');
COMMIT;

-- Acteur non déclaré (hors de tout set_config)
BEGIN;
SELECT pg_temp.expect_error('changement de statut sans acteur',
  $q$ INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, idempotency_key, request_fingerprint)
      VALUES ('TXN-NOACTOR', 'PAYMENT', 'WAVE', 100, 'XOF', '+2250700000003', 'idem-noactor', repeat('f',64)) $q$, 'LX007');
COMMIT;

-- Scellement : ajouter une paire ÉQUILIBRÉE à une écriture déjà commitée
BEGIN;
SELECT pg_temp.expect_error('ajout de lignes à une écriture scellée',
  $q$ INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
      SELECT e.id, a.id, v.d::"EntryDirection", 500, 'XOF'
      FROM (SELECT id FROM journal_entries WHERE description = 'Paiement TXN-TEST-0001') e,
           (VALUES ('merchant:demo:payable','DEBIT'),('revenue:fees','CREDIT')) v(c,d)
      JOIN ledger_accounts a ON a.code = v.c $q$, 'LX004');
COMMIT;

-- ---------------------------------------------------------------------------
-- CAS NOMINAL : contre-écriture conforme + remboursement partiel
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('app.actor_type', 'USER', true), set_config('app.actor_id', 'analyst-01', true),
       set_config('app.reason', 'Remboursement partiel demandé par le client', true);

-- Verrou pessimiste sur le parent : empêche deux remboursements concurrents
-- de dépasser le reste remboursable.
SELECT id FROM transactions WHERE reference = 'TXN-TEST-0001' FOR UPDATE;

INSERT INTO transactions (reference, type, provider, amount, currency, customer_msisdn, parent_transaction_id, idempotency_key, request_fingerprint)
SELECT 'RFD-TEST-0001', 'REFUND', 'ORANGE_MONEY', 4000, 'XOF', '+2250700000001', id, 'idem-rfd-0001', repeat('9', 64)
FROM transactions WHERE reference = 'TXN-TEST-0001';

UPDATE transactions SET status = 'PENDING'   WHERE reference = 'RFD-TEST-0001';
UPDATE transactions SET status = 'SUCCEEDED' WHERE reference = 'RFD-TEST-0001';
UPDATE transactions SET status = 'PARTIALLY_REFUNDED', refunded_amount = 4000 WHERE reference = 'TXN-TEST-0001';
COMMIT;

BEGIN;
WITH orig AS (SELECT id FROM journal_entries WHERE description = 'Paiement TXN-TEST-0001'),
     e AS (INSERT INTO journal_entries (description, reverses_entry_id) SELECT 'Contre-passation test', id FROM orig RETURNING id)
INSERT INTO ledger_postings (entry_id, account_id, direction, amount, currency)
SELECT e.id, p.account_id, CASE p.direction WHEN 'DEBIT' THEN 'CREDIT'::"EntryDirection" ELSE 'DEBIT'::"EntryDirection" END, p.amount, p.currency
FROM e, ledger_postings p WHERE p.entry_id = (SELECT id FROM orig);
COMMIT;

DO $$
BEGIN
  IF (SELECT balance FROM v_account_balances WHERE code = 'merchant:demo:payable') <> 0 THEN
    RAISE EXCEPTION 'ÉCHEC : solde marchand non nul après contre-passation';
  END IF;
  IF (SELECT status FROM transactions WHERE reference = 'TXN-TEST-0001') <> 'PARTIALLY_REFUNDED' THEN
    RAISE EXCEPTION 'ÉCHEC : statut remboursement partiel';
  END IF;
  IF EXISTS (SELECT 1 FROM v_trial_balance_violations) THEN
    RAISE EXCEPTION 'ÉCHEC : balance de vérification déséquilibrée';
  END IF;
  RAISE NOTICE 'OK    contre-écriture miroir acceptée, remboursement partiel cohérent, balance globale = 0';
END $$;

\echo ''
\echo 'Tous les tests d''intégrité sont passés.'
