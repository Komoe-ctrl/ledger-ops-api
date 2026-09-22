-- ============================================================================
-- 20260922000000_init_ledger
--
-- Partie 1 : structure (équivalent de ce que Prisma génère depuis schema.prisma)
-- Partie 2 : règles d'intégrité financière (SQL manuel, invisible pour Prisma)
--
-- Codes d'erreur applicatifs (SQLSTATE, classe "LX") — mappés côté API.
-- Le code est AUSSI préfixé dans le message ("[LX002] ...") : le mapping reste
-- fiable quelle que soit la forme d'erreur remontée par le driver/ORM.
--   LX001  table en ajout seul (UPDATE/DELETE/TRUNCATE interdit)
--   LX002  écriture déséquilibrée ou incomplète
--   LX003  devise incohérente (ligne / compte / écriture)
--   LX004  écriture scellée (ajout de ligne hors de sa transaction SQL)
--   LX005  transition de statut interdite
--   LX006  champ figé modifié
--   LX007  acteur non déclaré pour un changement de statut
--   LX008  contre-écriture non conforme à l'écriture d'origine
--   LX009  compte inactif
--   LX010  incohérence métier sur une transaction (remboursement, type…)
-- ============================================================================


-- ############################################################################
-- PARTIE 1 — STRUCTURE
-- ############################################################################

CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "Provider" AS ENUM ('ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'MOOV_MONEY');
CREATE TYPE "TransactionType" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'REVERSED');
CREATE TYPE "ActorType" AS ENUM ('USER', 'SYSTEM', 'PROVIDER');

CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "description" VARCHAR(500) NOT NULL,
    "transaction_id" UUID,
    "reverses_entry_id" UUID,
    "created_tx_id" BIGINT NOT NULL DEFAULT txid_current(),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "EntryDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(40) NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "provider" "Provider" NOT NULL,
    "provider_reference" VARCHAR(100),
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "refunded_amount" BIGINT NOT NULL DEFAULT 0,
    "customer_msisdn" VARCHAR(16) NOT NULL,
    "parent_transaction_id" UUID,
    "idempotency_key" VARCHAR(100) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transaction_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "from_status" "TransactionStatus",
    "to_status" "TransactionStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" VARCHAR(100),
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transaction_status_transitions" (
    "from_status" "TransactionStatus" NOT NULL,
    "to_status" "TransactionStatus" NOT NULL,
    CONSTRAINT "transaction_status_transitions_pkey" PRIMARY KEY ("from_status", "to_status")
);

-- Index & unicités
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");
CREATE UNIQUE INDEX "journal_entries_reverses_entry_id_key" ON "journal_entries"("reverses_entry_id");
CREATE INDEX "journal_entries_transaction_id_idx" ON "journal_entries"("transaction_id");
CREATE INDEX "journal_entries_created_at_idx" ON "journal_entries"("created_at");
CREATE INDEX "ledger_postings_entry_id_idx" ON "ledger_postings"("entry_id");
CREATE INDEX "ledger_postings_account_id_created_at_idx" ON "ledger_postings"("account_id", "created_at");
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");
CREATE UNIQUE INDEX "transactions_provider_provider_reference_key" ON "transactions"("provider", "provider_reference");
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");
CREATE INDEX "transactions_parent_transaction_id_idx" ON "transactions"("parent_transaction_id");
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");
CREATE INDEX "transaction_status_history_transaction_id_created_at_idx" ON "transaction_status_history"("transaction_id", "created_at");

-- Clés étrangères
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_transaction_id_fkey" FOREIGN KEY ("parent_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ############################################################################
-- PARTIE 2 — INTÉGRITÉ FINANCIÈRE (SQL manuel)
-- ############################################################################

-- ---------------------------------------------------------------------------
-- 2.1 Contraintes CHECK
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_currency_iso_chk" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "ledger_accounts_code_format_chk"  CHECK ("code" ~ '^[a-z0-9_]+(:[a-z0-9_]+)*$');

ALTER TABLE "ledger_postings"
  ADD CONSTRAINT "ledger_postings_amount_positive_chk" CHECK ("amount" > 0),
  ADD CONSTRAINT "ledger_postings_currency_iso_chk"    CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_not_self_reversal_chk" CHECK ("reverses_entry_id" IS NULL OR "reverses_entry_id" <> "id");

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_amount_positive_chk"   CHECK ("amount" > 0),
  ADD CONSTRAINT "transactions_currency_iso_chk"      CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "transactions_msisdn_e164_chk"       CHECK ("customer_msisdn" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "transactions_fingerprint_hex_chk"   CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "transactions_refunded_range_chk"    CHECK ("refunded_amount" >= 0 AND "refunded_amount" <= "amount"),
  -- Un REFUND a un parent ; un PAYMENT n'en a pas.
  ADD CONSTRAINT "transactions_parent_by_type_chk"    CHECK (("type" = 'REFUND') = ("parent_transaction_id" IS NOT NULL)),
  -- Seul un PAYMENT peut accumuler des remboursements / être contesté.
  ADD CONSTRAINT "transactions_refund_statuses_chk"   CHECK (
        "type" = 'PAYMENT'
     OR ("refunded_amount" = 0 AND "status" IN ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED'))
  ),
  -- Cohérence statut <-> montant remboursé.
  ADD CONSTRAINT "transactions_status_refund_consistency_chk" CHECK (
        ("status" NOT IN ('INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED') OR "refunded_amount" = 0)
    AND ("status" <> 'PARTIALLY_REFUNDED' OR ("refunded_amount" > 0 AND "refunded_amount" < "amount"))
    AND ("status" <> 'REFUNDED'           OR "refunded_amount" = "amount")
  );

-- ---------------------------------------------------------------------------
-- 2.2 Tables en ajout seul (écritures, lignes, historique, référentiel)
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_forbid_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[LX001] Table "%" en ajout seul : % interdit', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'LX001',
          HINT = 'Une erreur comptable se corrige par une contre-écriture, jamais par modification.';
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries', 'ledger_postings', 'transaction_status_history', 'transaction_status_transitions']
  LOOP
    EXECUTE format('CREATE TRIGGER "trg_%s_no_update_delete" BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"()', t, t);
    EXECUTE format('CREATE TRIGGER "trg_%s_no_truncate" BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"()', t, t);
  END LOOP;
END;
$$;

-- Les comptes et transactions ne se suppriment jamais non plus.
CREATE TRIGGER "trg_ledger_accounts_no_delete" BEFORE DELETE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_ledger_accounts_no_truncate" BEFORE TRUNCATE ON "ledger_accounts"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_transactions_no_delete" BEFORE DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_transactions_no_truncate" BEFORE TRUNCATE ON "transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();

-- ---------------------------------------------------------------------------
-- 2.3 Comptes : seuls name et is_active sont modifiables
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_ledger_accounts_frozen_fields"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION '[LX006] Compte %: seuls "name" et "is_active" sont modifiables', OLD."code"
      USING ERRCODE = 'LX006';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_ledger_accounts_frozen_fields" BEFORE UPDATE ON "ledger_accounts"
  FOR EACH ROW EXECUTE FUNCTION "fn_ledger_accounts_frozen_fields"();

-- ---------------------------------------------------------------------------
-- 2.4 Lignes d'écriture : devise, compte actif, écriture scellée
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_ledger_postings_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_account_currency CHAR(3);
  v_account_active   BOOLEAN;
  v_entry_tx         BIGINT;
BEGIN
  SELECT "currency", "is_active" INTO v_account_currency, v_account_active
    FROM "ledger_accounts" WHERE "id" = NEW."account_id";

  IF NOT v_account_active THEN
    RAISE EXCEPTION '[LX009] Compte % inactif', NEW."account_id" USING ERRCODE = 'LX009';
  END IF;

  IF v_account_currency <> NEW."currency" THEN
    RAISE EXCEPTION '[LX003] Devise de la ligne (%) différente de celle du compte (%)', NEW."currency", v_account_currency
      USING ERRCODE = 'LX003';
  END IF;

  -- Scellement : une écriture ne reçoit de lignes que dans la transaction SQL
  -- qui l'a créée. Impossible d'ajouter plus tard une paire "équilibrée"
  -- à une écriture ancienne.
  SELECT "created_tx_id" INTO v_entry_tx FROM "journal_entries" WHERE "id" = NEW."entry_id";
  IF v_entry_tx IS DISTINCT FROM txid_current() THEN
    RAISE EXCEPTION '[LX004] Écriture % scellée : ajout de ligne refusé', NEW."entry_id" USING ERRCODE = 'LX004';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_ledger_postings_before_insert" BEFORE INSERT ON "ledger_postings"
  FOR EACH ROW EXECUTE FUNCTION "fn_ledger_postings_before_insert"();

-- Une écriture est toujours créée "maintenant" : on interdit de forger created_tx_id.
CREATE FUNCTION "fn_journal_entries_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."created_tx_id" := txid_current();
  NEW."created_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_journal_entries_before_insert" BEFORE INSERT ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION "fn_journal_entries_before_insert"();

-- ---------------------------------------------------------------------------
-- 2.5 Invariant central : chaque écriture est équilibrée (vérifié au COMMIT)
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_assert_entry_valid"(p_entry_id UUID) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_lines      INTEGER;
  v_currencies INTEGER;
  v_debit      NUMERIC;
  v_credit     NUMERIC;
  v_reverses   UUID;
BEGIN
  SELECT count(*),
         count(DISTINCT "currency"),
         coalesce(sum("amount") FILTER (WHERE "direction" = 'DEBIT'), 0),
         coalesce(sum("amount") FILTER (WHERE "direction" = 'CREDIT'), 0)
    INTO v_lines, v_currencies, v_debit, v_credit
    FROM "ledger_postings" WHERE "entry_id" = p_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION '[LX002] Écriture % : au moins 2 lignes requises (% trouvée(s))', p_entry_id, v_lines
      USING ERRCODE = 'LX002';
  END IF;

  IF v_currencies <> 1 THEN
    RAISE EXCEPTION '[LX003] Écriture % : plusieurs devises dans une même écriture', p_entry_id
      USING ERRCODE = 'LX003';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION '[LX002] Écriture % déséquilibrée : débit % <> crédit %', p_entry_id, v_debit, v_credit
      USING ERRCODE = 'LX002';
  END IF;

  -- Une contre-écriture doit être le miroir exact de l'écriture d'origine.
  SELECT "reverses_entry_id" INTO v_reverses FROM "journal_entries" WHERE "id" = p_entry_id;
  IF v_reverses IS NOT NULL THEN
    IF EXISTS (
      (SELECT "account_id", CASE "direction" WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END, "amount"
         FROM "ledger_postings" WHERE "entry_id" = v_reverses
       EXCEPT ALL
       SELECT "account_id", "direction"::text, "amount"
         FROM "ledger_postings" WHERE "entry_id" = p_entry_id)
      UNION ALL
      (SELECT "account_id", "direction"::text, "amount"
         FROM "ledger_postings" WHERE "entry_id" = p_entry_id
       EXCEPT ALL
       SELECT "account_id", CASE "direction" WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END, "amount"
         FROM "ledger_postings" WHERE "entry_id" = v_reverses)
    ) THEN
      RAISE EXCEPTION '[LX008] Contre-écriture % non conforme à l''écriture %', p_entry_id, v_reverses
        USING ERRCODE = 'LX008';
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION "fn_trg_entry_valid_from_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "fn_assert_entry_valid"(NEW."id");
  RETURN NULL;
END;
$$;

CREATE FUNCTION "fn_trg_entry_valid_from_posting"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "fn_assert_entry_valid"(NEW."entry_id");
  RETURN NULL;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED : la vérification a lieu au COMMIT, quand
-- toutes les lignes de l'écriture sont présentes. Le déclencheur côté
-- écriture attrape aussi le cas "écriture sans aucune ligne".
CREATE CONSTRAINT TRIGGER "trg_journal_entries_balanced"
  AFTER INSERT ON "journal_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fn_trg_entry_valid_from_entry"();

CREATE CONSTRAINT TRIGGER "trg_ledger_postings_balanced"
  AFTER INSERT ON "ledger_postings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "fn_trg_entry_valid_from_posting"();

-- ---------------------------------------------------------------------------
-- 2.6 Transactions : règles d'insertion
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_transactions_before_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent "transactions"%ROWTYPE;
BEGIN
  IF NEW."status" <> 'INITIATED' THEN
    RAISE EXCEPTION '[LX005] Une transaction naît au statut INITIATED (reçu : %)', NEW."status"
      USING ERRCODE = 'LX005';
  END IF;

  NEW."version"         := 1;
  NEW."refunded_amount" := 0;
  NEW."created_at"      := CURRENT_TIMESTAMP;
  NEW."updated_at"      := CURRENT_TIMESTAMP;

  IF NEW."type" = 'REFUND' THEN
    SELECT * INTO v_parent FROM "transactions" WHERE "id" = NEW."parent_transaction_id";
    IF v_parent."type" <> 'PAYMENT'
       OR v_parent."status" NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED')
       OR v_parent."currency" <> NEW."currency"
       OR v_parent."provider" <> NEW."provider"
       OR NEW."amount" > v_parent."amount" - v_parent."refunded_amount" THEN
      RAISE EXCEPTION '[LX010] Remboursement invalide pour la transaction %', NEW."parent_transaction_id"
        USING ERRCODE = 'LX010',
              DETAIL = 'Le parent doit être un paiement réussi, même devise et opérateur, montant <= reste remboursable.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_transactions_before_insert" BEFORE INSERT ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "fn_transactions_before_insert"();

-- ---------------------------------------------------------------------------
-- 2.7 Transactions : champs figés, machine à états, versionnage
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_transactions_before_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id"                    IS DISTINCT FROM OLD."id"
  OR NEW."reference"             IS DISTINCT FROM OLD."reference"
  OR NEW."type"                  IS DISTINCT FROM OLD."type"
  OR NEW."provider"              IS DISTINCT FROM OLD."provider"
  OR NEW."amount"                IS DISTINCT FROM OLD."amount"
  OR NEW."currency"              IS DISTINCT FROM OLD."currency"
  OR NEW."customer_msisdn"       IS DISTINCT FROM OLD."customer_msisdn"
  OR NEW."parent_transaction_id" IS DISTINCT FROM OLD."parent_transaction_id"
  OR NEW."idempotency_key"       IS DISTINCT FROM OLD."idempotency_key"
  OR NEW."request_fingerprint"   IS DISTINCT FROM OLD."request_fingerprint"
  OR NEW."created_at"            IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION '[LX006] Transaction % : champ figé modifié', OLD."reference" USING ERRCODE = 'LX006';
  END IF;

  -- La référence opérateur se pose une fois, puis ne bouge plus.
  IF OLD."provider_reference" IS NOT NULL
     AND NEW."provider_reference" IS DISTINCT FROM OLD."provider_reference" THEN
    RAISE EXCEPTION '[LX006] Transaction % : référence opérateur déjà posée', OLD."reference" USING ERRCODE = 'LX006';
  END IF;

  -- Le cumul remboursé ne peut qu'augmenter.
  IF NEW."refunded_amount" < OLD."refunded_amount" THEN
    RAISE EXCEPTION '[LX010] Transaction % : le montant remboursé ne peut pas diminuer', OLD."reference" USING ERRCODE = 'LX010';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status"
     AND NOT EXISTS (
       SELECT 1 FROM "transaction_status_transitions"
        WHERE "from_status" = OLD."status" AND "to_status" = NEW."status"
     ) THEN
    RAISE EXCEPTION '[LX005] Transition interdite pour %: % -> %', OLD."reference", OLD."status", NEW."status"
      USING ERRCODE = 'LX005';
  END IF;

  -- Verrouillage optimiste : l'application filtre sur "version" dans son WHERE ;
  -- la base garantit l'incrément, quoi que l'application envoie.
  NEW."version"    := OLD."version" + 1;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_transactions_before_update" BEFORE UPDATE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "fn_transactions_before_update"();

-- ---------------------------------------------------------------------------
-- 2.8 Historique des statuts : écrit par la base, avec acteur obligatoire
--
-- L'application déclare l'acteur dans la transaction SQL, AVANT l'écriture :
--   SELECT set_config('app.actor_type', 'USER', true);
--   SELECT set_config('app.actor_id',   '<id>', true);
--   SELECT set_config('app.reason',     '<motif>', true);   -- facultatif
-- (3e argument true = portée limitée à la transaction courante)
-- ---------------------------------------------------------------------------

CREATE FUNCTION "fn_transactions_record_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_actor_type TEXT := nullif(current_setting('app.actor_type', true), '');
  v_actor_id   TEXT := nullif(current_setting('app.actor_id', true), '');
  v_reason     TEXT := nullif(current_setting('app.reason', true), '');
BEGIN
  IF v_actor_type IS NULL THEN
    RAISE EXCEPTION '[LX007] Changement de statut sans acteur déclaré (app.actor_type)'
      USING ERRCODE = 'LX007';
  END IF;

  INSERT INTO "transaction_status_history"
    ("transaction_id", "from_status", "to_status", "actor_type", "actor_id", "reason")
  VALUES
    (NEW."id",
     CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD."status" END,
     NEW."status",
     v_actor_type::"ActorType",
     v_actor_id,
     v_reason);

  RETURN NULL;
END;
$$;

CREATE TRIGGER "trg_transactions_status_on_insert" AFTER INSERT ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION "fn_transactions_record_status"();

CREATE TRIGGER "trg_transactions_status_on_update" AFTER UPDATE OF "status" ON "transactions"
  FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "fn_transactions_record_status"();

-- ---------------------------------------------------------------------------
-- 2.9 Référentiel des transitions (la machine à états, en données)
-- Terminaux : FAILED, EXPIRED, REFUNDED, REVERSED (aucune sortie)
-- ---------------------------------------------------------------------------

INSERT INTO "transaction_status_transitions" ("from_status", "to_status") VALUES
  ('INITIATED',          'PENDING'),
  ('INITIATED',          'FAILED'),
  ('PENDING',            'SUCCEEDED'),
  ('PENDING',            'FAILED'),
  ('PENDING',            'EXPIRED'),
  ('SUCCEEDED',          'PARTIALLY_REFUNDED'),
  ('SUCCEEDED',          'REFUNDED'),
  ('SUCCEEDED',          'DISPUTED'),
  ('PARTIALLY_REFUNDED', 'REFUNDED'),
  ('PARTIALLY_REFUNDED', 'DISPUTED'),
  ('DISPUTED',           'SUCCEEDED'),           -- litige gagné, rien remboursé
  ('DISPUTED',           'PARTIALLY_REFUNDED'),  -- litige gagné, remboursements partiels antérieurs
  ('DISPUTED',           'REVERSED');            -- litige perdu, fonds repris

-- ---------------------------------------------------------------------------
-- 2.10 Soldes : toujours DÉRIVÉS des lignes, jamais stockés
-- (Vue non gérée par Prisma ; lue via $queryRaw / TypedSQL.)
-- ---------------------------------------------------------------------------

CREATE VIEW "v_account_balances" AS
SELECT
  a."id"       AS "account_id",
  a."code",
  a."type",
  a."currency",
  coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'DEBIT'), 0)  AS "total_debit",
  coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'CREDIT'), 0) AS "total_credit",
  CASE WHEN a."type" IN ('ASSET', 'EXPENSE')
       THEN coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'DEBIT'), 0)
          - coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'CREDIT'), 0)
       ELSE coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'CREDIT'), 0)
          - coalesce(sum(p."amount") FILTER (WHERE p."direction" = 'DEBIT'), 0)
  END AS "balance"
FROM "ledger_accounts" a
LEFT JOIN "ledger_postings" p ON p."account_id" = a."id"
GROUP BY a."id", a."code", a."type", a."currency";

-- Contrôle global (balance de vérification) : doit toujours renvoyer 0 ligne.
CREATE VIEW "v_trial_balance_violations" AS
SELECT "currency",
       sum("amount") FILTER (WHERE "direction" = 'DEBIT')  AS "total_debit",
       sum("amount") FILTER (WHERE "direction" = 'CREDIT') AS "total_credit"
FROM "ledger_postings"
GROUP BY "currency"
HAVING sum("amount") FILTER (WHERE "direction" = 'DEBIT')
    <> sum("amount") FILTER (WHERE "direction" = 'CREDIT');
