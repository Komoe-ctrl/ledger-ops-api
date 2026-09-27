-- CreateEnum
CREATE TYPE "ApiRole" AS ENUM ('MERCHANT', 'OPERATOR', 'ANALYST', 'ADMIN');

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "label" VARCHAR(200) NOT NULL,
    "role" "ApiRole" NOT NULL,
    "hashed_key" VARCHAR(64) NOT NULL,
    "merchant_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_hashed_key_key" ON "api_keys"("hashed_key");

-- CreateIndex
CREATE INDEX "api_keys_merchant_id_idx" ON "api_keys"("merchant_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Règles d'intégrité :
--   - role = MERCHANT <=> merchant_id renseigné (même pattern que
--     transactions_parent_by_type_chk pour REFUND/parent_transaction_id) ;
--   - is_active/revoked_at cohérents entre eux ;
--   - ajout seul, jamais de suppression ;
--   - champs figés dès la création, SAUF label (description humaine,
--     librement modifiable, comme LedgerAccount.name) ;
--   - révocation à SENS UNIQUE : une fois revoked_at posé, plus rien ne
--     bouge — pas de "dé-révocation", jamais. Une clé compromise doit être
--     remplacée par une nouvelle, pas réactivée.
-- ============================================================================

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_merchant_role_chk" CHECK (("role" = 'MERCHANT') = ("merchant_id" IS NOT NULL)),
  ADD CONSTRAINT "api_keys_active_revoked_consistency_chk" CHECK (
    ("is_active" = true AND "revoked_at" IS NULL) OR ("is_active" = false AND "revoked_at" IS NOT NULL)
  );

CREATE TRIGGER "trg_api_keys_no_delete" BEFORE DELETE ON "api_keys"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_api_keys_no_truncate" BEFORE TRUNCATE ON "api_keys"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();

CREATE FUNCTION "fn_api_keys_before_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id"          IS DISTINCT FROM OLD."id"
  OR NEW."role"         IS DISTINCT FROM OLD."role"
  OR NEW."hashed_key"   IS DISTINCT FROM OLD."hashed_key"
  OR NEW."merchant_id"  IS DISTINCT FROM OLD."merchant_id"
  OR NEW."created_at"   IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION '[LX006] Clé API % : champ figé modifié', OLD."id" USING ERRCODE = 'LX006';
  END IF;

  IF OLD."revoked_at" IS NOT NULL AND (
       NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at"
    OR NEW."is_active"  IS DISTINCT FROM OLD."is_active"
  ) THEN
    RAISE EXCEPTION '[LX006] Clé API % : déjà révoquée', OLD."id" USING ERRCODE = 'LX006';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_api_keys_before_update" BEFORE UPDATE ON "api_keys"
  FOR EACH ROW EXECUTE FUNCTION "fn_api_keys_before_update"();
