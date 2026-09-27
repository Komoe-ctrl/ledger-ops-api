-- ============================================================================
-- transaction_merchant_id
--
-- Ajout d'une colonne obligatoire sur une table déjà peuplée : jamais en un
-- seul ALTER COLUMN ... NOT NULL direct (échouerait, et de toute façon
-- verrouillerait toute la table le temps de la validation sur une vraie
-- volumétrie). Séquence sûre : nullable -> backfill -> NOT NULL.
--
-- Le backfill pointe vers le marchand "demo" : toutes les transactions
-- existantes ont été créées avant que le multi-marchand n'existe, donc
-- appartiennent de fait à ce marchand unique jusqu'ici.
-- ============================================================================

ALTER TABLE "transactions" ADD COLUMN "merchant_id" UUID;

UPDATE "transactions"
  SET "merchant_id" = (SELECT "id" FROM "merchants" WHERE "code" = 'demo')
  WHERE "merchant_id" IS NULL;

ALTER TABLE "transactions" ALTER COLUMN "merchant_id" SET NOT NULL;

CREATE INDEX "transactions_merchant_id_idx" ON "transactions"("merchant_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- merchant_id rejoint les champs figés (3e ajout à cette fonction — après
-- expires_at — sans qu'un mécanisme générique ne se justifie encore pour
-- si peu d'occurrences).
-- ============================================================================

CREATE OR REPLACE FUNCTION "fn_transactions_before_update"() RETURNS trigger
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
  OR NEW."merchant_id"           IS DISTINCT FROM OLD."merchant_id"
  OR NEW."idempotency_key"       IS DISTINCT FROM OLD."idempotency_key"
  OR NEW."request_fingerprint"   IS DISTINCT FROM OLD."request_fingerprint"
  OR NEW."expires_at"            IS DISTINCT FROM OLD."expires_at"
  OR NEW."created_at"            IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION '[LX006] Transaction % : champ figé modifié', OLD."reference" USING ERRCODE = 'LX006';
  END IF;

  IF OLD."provider_reference" IS NOT NULL
     AND NEW."provider_reference" IS DISTINCT FROM OLD."provider_reference" THEN
    RAISE EXCEPTION '[LX006] Transaction % : référence opérateur déjà posée', OLD."reference" USING ERRCODE = 'LX006';
  END IF;

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

  NEW."version"    := OLD."version" + 1;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
