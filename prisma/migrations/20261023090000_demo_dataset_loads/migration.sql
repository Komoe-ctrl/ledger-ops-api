-- CreateTable
CREATE TABLE "demo_dataset_loads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_dataset_loads_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Règles d'intégrité : registre en ajout seul (ADR 0003), même philosophie
-- que reconciliation_exceptions. seed-demo.ts y inscrit une ligne à la fin de
-- chaque chargement ; GET /v1/stats expose la plus récente. Sans ce registre,
-- la date de chargement du jeu de démonstration ne serait qu'une déduction
-- (par exemple la plus ancienne transaction) présentée comme un fait.
-- Remis à zéro par scripts/reset-demo-data.sql (opération de maintenance
-- déclarée, rôle propriétaire), jamais par l'application.
-- ============================================================================

CREATE TRIGGER "trg_demo_dataset_loads_no_update_delete" BEFORE UPDATE OR DELETE ON "demo_dataset_loads"
  FOR EACH ROW EXECUTE FUNCTION "fn_forbid_mutation"();
CREATE TRIGGER "trg_demo_dataset_loads_no_truncate" BEFORE TRUNCATE ON "demo_dataset_loads"
  FOR EACH STATEMENT EXECUTE FUNCTION "fn_forbid_mutation"();

-- Privilèges minimaux (ADR 0003) : ajout et lecture seulement.
GRANT SELECT, INSERT ON "demo_dataset_loads" TO "ledger_app";
