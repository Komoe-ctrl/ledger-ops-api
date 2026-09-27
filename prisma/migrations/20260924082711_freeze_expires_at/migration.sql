-- ============================================================================
-- freeze_expires_at
--
-- "expires_at" n'était pas dans la liste des champs figés de
-- fn_transactions_before_update : n'importe qui pouvait repousser
-- l'échéance d'une transaction sans laisser de trace (pas de changement de
-- statut => pas de ligne d'historique, pas d'acteur requis). Trouvé en
-- revue externe de la branche feat/auto-expiration.
--
-- CREATE OR REPLACE : on redéfinit la fonction existante, le trigger qui la
-- référence par son nom n'a pas besoin d'être recréé.
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
  OR NEW."idempotency_key"       IS DISTINCT FROM OLD."idempotency_key"
  OR NEW."request_fingerprint"   IS DISTINCT FROM OLD."request_fingerprint"
  OR NEW."expires_at"            IS DISTINCT FROM OLD."expires_at"
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

  NEW."version"    := OLD."version" + 1;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- Empêche une valeur absurde d'exister dès la création, indépendamment du
-- gel ci-dessus (qui n'empêche qu'une modification APRÈS coup).
ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_expires_at_after_created_chk"
  CHECK ("expires_at" IS NULL OR "expires_at" > "created_at");
