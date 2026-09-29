# ADR 0003 — Les règles d'intégrité financière vivent dans PostgreSQL

**Statut** : accepté · **Date** : 2026-09-22

## Contexte
Un bug applicatif, un script de maintenance ou un accès direct à la base ne doivent jamais pouvoir produire un grand livre faux. Les validations côté code sont nécessaires (bons messages d'erreur) mais pas suffisantes.

## Décision
La base est la dernière ligne de défense. La migration `init_ledger` impose :

| Règle | Mécanisme | Code |
|---|---|---|
| Écritures, lignes, historique en ajout seul | Triggers `BEFORE UPDATE/DELETE/TRUNCATE` | LX001 |
| Écriture équilibrée, ≥ 2 lignes | Constraint trigger `DEFERRABLE INITIALLY DEFERRED` (vérifié au COMMIT) | LX002 |
| Devise ligne = compte, écriture mono-devise | Trigger + contrôle au COMMIT | LX003 |
| Écriture scellée (pas d'ajout de ligne après coup) | `created_tx_id = txid_current()` | LX004 |
| Machine à états des transactions | Table `transaction_status_transitions` + trigger | LX005 |
| Champs figés (montant, devise, référence…) | Trigger `BEFORE UPDATE` | LX006 |
| Tout changement de statut a un acteur | `set_config('app.actor_*')` lu par trigger | LX007 |
| Contre-écriture = miroir exact | Comparaison multiensemble au COMMIT | LX008 |
| Cohérence remboursements / statuts | `CHECK` + trigger | LX010, 23514 |

Prisma décrit la structure ; ces règles sont en SQL manuel dans la migration. Les tests `test/integrity.sql` vérifient chaque règle avec son code d'erreur exact.

## Conséquences
+ Garanties indépendantes du code applicatif.
− Logique répartie entre SQL et TypeScript : chaque règle SQL est documentée ici et testée.

## Addendum (jalon 4) — rôles PostgreSQL à privilèges minimaux
La migration `least_privilege_app_role` crée un rôle `ledger_app`, distinct du rôle propriétaire qui exécute les migrations. L'API se connecte toujours avec `ledger_app` (`APP_DATABASE_URL`), jamais avec le rôle propriétaire (`DATABASE_URL`, réservé aux migrations).

`ledger_app` n'a ni `UPDATE` ni `DELETE` sur `journal_entries`, `ledger_postings`, `transaction_status_history` (SELECT/INSERT seulement — cohérent avec LX001 : la protection existe maintenant à deux niveaux indépendants, trigger et privilège) ; `SELECT` seul sur `transaction_status_transitions` (référentiel jamais écrit par l'app) ; aucun droit de `CREATE`/`ALTER`/`DROP`. Un bug applicatif ou une injection SQL ne peut donc pas corrompre le grand livre même en contournant entièrement le code TypeScript — l'erreur serait `42501` (insufficient_privilege), avant même qu'un trigger n'ait la moindre chance de s'exécuter.

Vérifié par `test/least-privilege.sql` (à exécuter avec `APP_DATABASE_URL`, symétrique de `test/integrity.sql`).
