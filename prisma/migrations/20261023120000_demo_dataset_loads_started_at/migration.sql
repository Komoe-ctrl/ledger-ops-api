-- AlterTable
-- Début du chargement (horloge de la base, comme created_at des transactions).
-- Avec loaded_at (fin), il borne la « fenêtre du jeu de démonstration » sur
-- laquelle GET /v1/stats calcule le taux de rapprochement (ADR 0009).
-- Nullable : les lignes écrites avant cette migration n'ont pas de début
-- connu, et le registre est en ajout seul (aucun UPDATE possible, ADR 0003) ;
-- elles sont ignorées pour la fenêtre jusqu'au prochain chargement.
ALTER TABLE "demo_dataset_loads" ADD COLUMN "started_at" TIMESTAMPTZ(3);
