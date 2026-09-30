-- ============================================================================
-- grant_views_to_app_role
--
-- Trou oublié par la migration least_privilege_app_role (ADR 0003) : elle
-- accordait SELECT/INSERT/UPDATE sur les TABLES, mais jamais SELECT sur les
-- deux vues créées par init_ledger (v_account_balances,
-- v_trial_balance_violations). En Postgres, une vue vérifie le privilège
-- SELECT sur la vue ELLE-MÊME, pas seulement sur les tables sous-jacentes —
-- "ledger_app" n'y avait donc aucun accès, découvert en faisant vérifier
-- l'équilibre du grand livre par le seed de démo (jalon 5).
-- ============================================================================

GRANT SELECT ON "v_account_balances", "v_trial_balance_violations" TO "ledger_app";
