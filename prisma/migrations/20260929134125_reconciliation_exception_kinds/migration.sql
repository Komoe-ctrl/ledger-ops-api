-- ============================================================================
-- reconciliation_exception_kinds
--
-- ADR 0007 scopait volontairement reconciliation_exceptions à un seul cas
-- (acquittement tardif). ADR 0008 étend le type d'exception à 3 nouveaux cas
-- (écarts avec un relevé opérateur), sans modèle "relevé" ni moteur de diff —
-- juste un type d'exception plus riche, rapporté via
-- ReconciliationService.reportDiscrepancy().
-- ============================================================================

CREATE TYPE "ReconciliationExceptionKind" AS ENUM (
  'LATE_ACKNOWLEDGMENT',
  'MISSING_IN_STATEMENT',
  'MISSING_LOCALLY',
  'AMOUNT_MISMATCH'
);

-- kind : nullable -> backfill -> NOT NULL (séquence sûre sur une table déjà
-- peuplée, même logique que transaction_merchant_id, jalon 4 étape 2).
-- Toutes les lignes existantes sont forcément LATE_ACKNOWLEDGMENT : c'était
-- le seul cas que le système savait produire avant cette migration.
ALTER TABLE "reconciliation_exceptions" ADD COLUMN "kind" "ReconciliationExceptionKind";
UPDATE "reconciliation_exceptions" SET "kind" = 'LATE_ACKNOWLEDGMENT' WHERE "kind" IS NULL;
ALTER TABLE "reconciliation_exceptions" ALTER COLUMN "kind" SET NOT NULL;

-- transaction_id devient nullable : MISSING_LOCALLY n'a, par définition,
-- aucune transaction locale à référencer (le relevé opérateur mentionne une
-- référence que nous n'avons jamais vue).
ALTER TABLE "reconciliation_exceptions" ALTER COLUMN "transaction_id" DROP NOT NULL;

-- reported_status devient nullable : ne fait sens que pour LATE_ACKNOWLEDGMENT
-- ("ce que l'opérateur prétend" comme statut) — les 3 autres types portent
-- leur description dans "detail", pas dans un statut de transaction.
ALTER TABLE "reconciliation_exceptions" ALTER COLUMN "reported_status" DROP NOT NULL;

ALTER TABLE "reconciliation_exceptions" ADD COLUMN "detail" VARCHAR(500);

-- Cohérence, en base : transaction_id est NULL si et seulement si
-- kind = MISSING_LOCALLY.
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_transaction_id_kind_chk"
  CHECK (("kind" = 'MISSING_LOCALLY') = ("transaction_id" IS NULL));

-- reported_status obligatoire pour LATE_ACKNOWLEDGMENT, absent sinon.
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_reported_status_kind_chk"
  CHECK (("kind" = 'LATE_ACKNOWLEDGMENT') = ("reported_status" IS NOT NULL));

-- kind/detail rejoignent les champs figés (le reste de la fonction est
-- inchangé — voir migration reconciliation_exceptions, jalon 3).
CREATE OR REPLACE FUNCTION "fn_reconciliation_exceptions_before_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id"                  IS DISTINCT FROM OLD."id"
  OR NEW."transaction_id"      IS DISTINCT FROM OLD."transaction_id"
  OR NEW."kind"                IS DISTINCT FROM OLD."kind"
  OR NEW."reported_status"     IS DISTINCT FROM OLD."reported_status"
  OR NEW."provider_reference"  IS DISTINCT FROM OLD."provider_reference"
  OR NEW."detail"              IS DISTINCT FROM OLD."detail"
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
