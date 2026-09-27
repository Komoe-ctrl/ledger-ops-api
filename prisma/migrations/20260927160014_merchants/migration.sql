-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- ============================================================================
-- Règles d'intégrité : même philosophie que ledger_accounts (ADR 0003) —
-- ne se supprime jamais, seuls name/is_active sont modifiables.
-- ============================================================================

CREATE TRIGGER "trg_merchants_no_delete" BEFORE DELETE ON "merchants"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_merchants_no_truncate" BEFORE TRUNCATE ON "merchants"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();

CREATE FUNCTION "fn_merchants_frozen_fields"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id"         IS DISTINCT FROM OLD."id"
  OR NEW."code"        IS DISTINCT FROM OLD."code"
  OR NEW."created_at"  IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION '[LX006] Marchand %: seuls "name" et "is_active" sont modifiables', OLD."code"
      USING ERRCODE = 'LX006';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_merchants_frozen_fields" BEFORE UPDATE ON "merchants"
  FOR EACH ROW EXECUTE FUNCTION "fn_merchants_frozen_fields"();

-- Le marchand qui remplace le "merchant:demo:payable" jusqu'ici codé en dur
-- (ADR 0004/0005). Son compte comptable existe déjà (migration
-- seed_chart_of_accounts) et suit exactement la convention merchant:<code>:payable
-- — pas besoin de le recréer, juste de faire exister le marchand lui-même.
INSERT INTO "merchants" ("code", "name") VALUES ('demo', 'Marchand démo')
  ON CONFLICT ("code") DO NOTHING;
