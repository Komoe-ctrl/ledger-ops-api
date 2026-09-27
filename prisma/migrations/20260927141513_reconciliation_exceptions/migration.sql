-- CreateTable
CREATE TABLE "reconciliation_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "reported_status" "TransactionStatus" NOT NULL,
    "provider_reference" VARCHAR(100),
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" VARCHAR(100),
    "resolution" VARCHAR(2000),

    CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_exceptions_transaction_id_idx" ON "reconciliation_exceptions"("transaction_id");

-- CreateIndex
CREATE INDEX "reconciliation_exceptions_resolved_at_idx" ON "reconciliation_exceptions"("resolved_at");

-- AddForeignKey
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Règles d'intégrité (voir ADR 0003 / 0007) :
--   - jamais de suppression, jamais de TRUNCATE (même philosophie qu'ailleurs
--     dans ce schéma : une exception se résout, elle ne s'efface pas) ;
--   - les champs de détection sont figés dès la création ;
--   - resolved_at/resolved_by/resolution se posent ensemble, une seule fois,
--     jamais réécrits, et la justification ne peut pas être vide.
-- ============================================================================

CREATE TRIGGER "trg_reconciliation_exceptions_no_delete" BEFORE DELETE ON "reconciliation_exceptions"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_reconciliation_exceptions_no_truncate" BEFORE TRUNCATE ON "reconciliation_exceptions"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();

CREATE FUNCTION "fn_reconciliation_exceptions_before_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id"                  IS DISTINCT FROM OLD."id"
  OR NEW."transaction_id"      IS DISTINCT FROM OLD."transaction_id"
  OR NEW."reported_status"     IS DISTINCT FROM OLD."reported_status"
  OR NEW."provider_reference"  IS DISTINCT FROM OLD."provider_reference"
  OR NEW."detected_at"         IS DISTINCT FROM OLD."detected_at" THEN
    RAISE EXCEPTION '[LX006] Exception de rapprochement % : champ figé modifié', OLD."id" USING ERRCODE = 'LX006';
  END IF;

  IF OLD."resolved_at" IS NOT NULL AND (
       NEW."resolved_at" IS DISTINCT FROM OLD."resolved_at"
    OR NEW."resolved_by" IS DISTINCT FROM OLD."resolved_by"
    OR NEW."resolution"  IS DISTINCT FROM OLD."resolution"
  ) THEN
    RAISE EXCEPTION '[LX006] Exception de rapprochement % : déjà résolue', OLD."id" USING ERRCODE = 'LX006';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_reconciliation_exceptions_before_update" BEFORE UPDATE ON "reconciliation_exceptions"
  FOR EACH ROW EXECUTE FUNCTION "fn_reconciliation_exceptions_before_update"();

ALTER TABLE "reconciliation_exceptions"
  ADD CONSTRAINT "reconciliation_exceptions_resolution_together_chk" CHECK (
    ("resolved_at" IS NULL AND "resolved_by" IS NULL AND "resolution" IS NULL)
    OR ("resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL AND "resolution" IS NOT NULL)
  ),
  ADD CONSTRAINT "reconciliation_exceptions_resolution_not_blank_chk"
    CHECK ("resolution" IS NULL OR btrim("resolution") <> '');
