# ADR 0004 — Commission de 1,5 %, arrondie au franc inférieur

**Statut** : accepté · **Date** : 2026-09-22

## Contexte
Au passage d'un paiement à `SUCCEEDED`, l'écriture comptable doit répartir le montant encaissé entre ce qui revient au marchand et la commission de la plateforme. Un pourcentage sur un montant entier ne tombe pas toujours rond, et ADR 0002 interdit déjà le flottant pour tout ce qui touche à l'argent.

## Décision
Commission = 1,5 % du montant, arrondie **au franc inférieur** (troncature, jamais au plus proche) — en faveur du marchand : dans le doute, il ne perd jamais plus que le taux nominal.

Calcul en entiers (`bigint`), jamais en flottant : `commission = (amount * 15n) / 1000n`. La division entière bigint tronque vers zéro, ce qui équivaut à un `floor` pour un montant positif.

Écriture posée dans la **même transaction SQL** que le passage à `SUCCEEDED` (voir ADR 0001) :

| Compte | Débit | Crédit |
|---|---|---|
| `provider:<provider>:clearing` | `amount` | |
| `merchant:demo:payable` | | `amount - commission` |
| `revenue:fees` | | `commission` |

Si `commission = 0` (très petit montant), la ligne `revenue:fees` est **omise**, pas posée à 0 : `ledger_postings` impose `amount > 0` (migration `init_ledger`).

Ne s'applique qu'à la transition `PENDING -> SUCCEEDED` (le paiement opérateur vient d'être confirmé, c'est le seul moment où l'argent bouge réellement). Un retour ultérieur à `SUCCEEDED` depuis `DISPUTED` (litige gagné, jalon suivant) ne rebooke pas : l'écriture d'origine reste la seule source de vérité sur cette commission.

## Conséquences
+ Aucune ambiguïté d'arrondi, aucun flottant.
+ Le marchand est toujours protégé du côté "défavorable" de l'arrondi.
− Un seul marchand démo pour l'instant (`merchant:demo:payable`) ; le multi-marchand (résolution du compte payable par transaction) est hors périmètre du jalon 2.
