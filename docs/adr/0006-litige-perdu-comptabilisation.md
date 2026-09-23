# ADR 0006 — Comptabilisation d'un litige perdu (`DISPUTED -> REVERSED`)

**Statut** : accepté · **Date** : 2026-09-23

## Contexte
La machine à états (migration `init_ledger`, jalon 1) prévoit déjà `SUCCEEDED`/`PARTIALLY_REFUNDED -> DISPUTED -> {SUCCEEDED, PARTIALLY_REFUNDED, REVERSED}`. Les deux premiers cas ("litige gagné") ne bougent aucun argent : la transaction retrouve simplement son statut d'avant le litige, sans nouvelle écriture — déjà couvert par le garde-fou posé au jalon 2, étape 10 (l'écriture n'est postée qu'au passage `PENDING -> SUCCEEDED`, jamais à un retour depuis `DISPUTED`). Reste `REVERSED` ("litige perdu, fonds repris") : l'opérateur reprend les fonds, il faut décider comment l'écrire.

## Décision
`DISPUTED -> REVERSED` reprend tout ce qu'il restait dû au marchand (`amount - refunded_amount`, forcément > 0 : une transaction déjà `REFUNDED` en totalité n'a pas de sortie possible vers `DISPUTED` dans la table des transitions). Même mécanisme à deux lignes qu'un remboursement (ADR 0005), pour le montant restant :

| Compte | Débit | Crédit |
|---|---|---|
| `merchant:<id>:payable` | reste (`amount - refunded_amount`) | |
| `provider:<provider>:clearing` | | reste |

`refunded_amount` est porté à `amount` (plus rien dû, comme pour un remboursement total) — la transaction est traitée pour tout solde restant comme si l'opérateur venait de forcer un remboursement complet.

**Commission non reversée**, par cohérence avec ADR 0005 — même si, en réalité, un rétrofacturation ("chargeback") côté opérateur reprend parfois aussi la commission de la plateforme. Rien dans le projet ne fixe cette politique ; ce choix privilégie la cohérence/simplicité (un seul mécanisme de reprise partout) plutôt qu'une règle spécifique aux litiges. **À revoir si le produit précise un jour une politique différente.**

## Conséquences
+ Même mécanisme que les remboursements — pas de nouveau type d'écriture, pas de nouvel endpoint (la transition `DISPUTED -> REVERSED` passe par `PATCH /v1/transactions/:reference/status`, déjà existant).
− La commission reste acquise à la plateforme même sur un litige perdu, ce qui peut ne pas correspondre à la réalité contractuelle avec l'opérateur. Décision à valider avec le produit avant tout déploiement réel.
