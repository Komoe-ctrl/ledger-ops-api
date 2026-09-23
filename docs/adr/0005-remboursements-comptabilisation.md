# ADR 0005 — Comptabilisation des remboursements

**Statut** : accepté · **Date** : 2026-09-23

## Contexte
Un remboursement (partiel ou total) est un **nouvel événement économique**, pas une correction d'erreur — contrairement à la contre-écriture miroir décrite en ADR 0001 (`reverses_entry_id`, vérifiée par le trigger LX008), qui sert à corriger une écriture fautive, jamais à modéliser un remboursement légitime. Il faut décider comment l'écrire au grand livre : en particulier, la commission déjà perçue par la plateforme au moment du paiement doit-elle être rendue ?

## Décision
Le remboursement, quel que soit son montant (partiel ou total), est une écriture **indépendante**, jamais une contre-passation de l'écriture de paiement d'origine :

| Compte | Débit | Crédit |
|---|---|---|
| `merchant:<id>:payable` | `refundAmount` | |
| `provider:<provider>:clearing` | | `refundAmount` |

La commission (`revenue:fees`) **n'est pas reversée** : une fois perçue au passage à `SUCCEEDED` du paiement (ADR 0004), elle reste acquise à la plateforme, remboursé ou non.

Plusieurs remboursements partiels successifs sur le même paiement utilisent chacun ce même schéma à deux lignes, pour leur propre montant. `transactions.refunded_amount` cumule (le trigger `fn_transactions_before_update` interdit qu'il diminue) ; `status` passe à `PARTIALLY_REFUNDED` puis `REFUNDED` une fois le cumul égal au montant payé — sans transition explicite requise entre deux `PARTIALLY_REFUNDED` successifs, puisque `fn_transactions_before_update` ne vérifie la table `transaction_status_transitions` que lorsque le statut change réellement (`IS DISTINCT FROM`).

`reverses_entry_id`/LX008 (contre-écriture miroir exacte) reste réservé à la correction d'une erreur comptable — non utilisé ici.

## Conséquences
+ Un seul mécanisme, quel que soit le nombre ou la taille des remboursements — pas de cas spécial pour "remboursement total en un coup".
+ La plateforme garde sa commission sur un paiement remboursé (politique choisie ici ; à revoir si le produit décide un jour de la reverser).
− Les litiges perdus (`DISPUTED -> REVERSED`, prochaine fonctionnalité) devront trancher séparément s'ils suivent la même règle ou reversent aussi la commission — pas tranché par cette ADR.
