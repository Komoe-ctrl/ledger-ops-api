# ADR 0001 — Grand livre en partie double

**Statut** : accepté · **Date** : 2026-09-22

## Contexte
Le système manipule des fonds encaissés via des opérateurs mobile money pour le compte de marchands. Un simple champ `balance` modifié par l'application ne permet ni d'expliquer un solde, ni de détecter une erreur, ni de corriger proprement.

## Décision
Tout mouvement de fonds est une **écriture** (`journal_entries`) composée d'au moins deux **lignes** (`ledger_postings`) dont la somme des débits égale la somme des crédits. Les soldes sont **dérivés** des lignes (`v_account_balances`), jamais stockés. Une erreur se corrige par une **contre-écriture** miroir, jamais par modification.

Plan comptable initial (XOF) — exemple d'un paiement de 10 000 avec 150 de commission :

| Compte | Type | Débit | Crédit |
|---|---|---|---|
| `provider:orange_money:clearing` (créance sur l'opérateur) | ASSET | 10 000 | |
| `merchant:<id>:payable` (dû au marchand) | LIABILITY | | 9 850 |
| `revenue:fees` (commissions) | REVENUE | | 150 |

## Conséquences
+ Chaque franc est traçable ; la balance globale est vérifiable à tout moment (`v_trial_balance_violations` doit être vide).
+ Le rapprochement (jalon 3) compare les comptes de compensation opérateur au relevé externe.
− Calcul des soldes par agrégation : acceptable à ce volume. À grande échelle, on ajoutera des soldes instantanés (snapshots) périodiques, eux aussi en ajout seul.
