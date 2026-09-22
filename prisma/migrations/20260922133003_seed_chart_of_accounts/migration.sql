-- ============================================================================
-- seed_chart_of_accounts
--
-- Plan comptable de base (XOF) : un compte de compensation par opérateur,
-- le compte "dû au marchand démo", et le compte de commissions.
-- Voir docs/adr/0001-grand-livre-partie-double.md.
--
-- ON CONFLICT (code) DO NOTHING : cette migration doit pouvoir être rejouée
-- (ex. `migrate deploy` sur un environnement où les comptes existent déjà)
-- sans jamais écraser un compte existant. `name`/`is_active` sont les seuls
-- champs modifiables (trigger fn_ledger_accounts_frozen_fields) ; toute
-- évolution du libellé passe par une migration dédiée, pas par ce script.
-- ============================================================================

INSERT INTO "ledger_accounts" ("code", "name", "type", "currency") VALUES
  ('provider:orange_money:clearing', 'Créance Orange Money',  'ASSET',     'XOF'),
  ('provider:mtn_momo:clearing',     'Créance MTN MoMo',      'ASSET',     'XOF'),
  ('provider:wave:clearing',         'Créance Wave',          'ASSET',     'XOF'),
  ('provider:moov_money:clearing',   'Créance Moov Money',    'ASSET',     'XOF'),
  ('merchant:demo:payable',          'Dû au marchand démo',   'LIABILITY', 'XOF'),
  ('revenue:fees',                   'Commissions',           'REVENUE',   'XOF')
ON CONFLICT ("code") DO NOTHING;
