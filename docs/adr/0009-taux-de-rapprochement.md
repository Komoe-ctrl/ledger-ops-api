# ADR 0009 — Définition du taux de rapprochement exposé par `GET /v1/stats`

**Statut** : accepté · **Date** : 2026-10-23

## Contexte
Le tableau de bord de démonstration affiche un « taux de rapprochement ». Une première version le déduisait côté navigateur à partir de listes paginées : une estimation présentée comme une donnée. Elle a été retirée (un chiffre faux est pire qu'un chiffre absent), puis la carte est restée « Indisponible », ce qui ressemble à une fonctionnalité cassée.

Il faut une définition **exacte**, calculée par la base, que l'on puisse énoncer en une phrase et dont on sache dire ce qu'elle ne prouve pas.

Contrainte structurelle (ADR 0008) : il n'existe ni modèle « relevé opérateur » ni moteur de diff. Le système ne sait pas qu'une transaction a été **confirmée** par un relevé ; il sait seulement qu'un écart a été **rapporté** (exception de rapprochement) et si cet écart est résolu.

## Décision
Sur la **fenêtre du jeu de démonstration** :

```
taux de rapprochement = transactions rapprochées / transactions dénouées
```

- **Dénouée** : transaction dont le statut n'est ni `INITIATED` ni `PENDING` (paiements et remboursements). Tant que l'opérateur n'a pas rendu de verdict, il n'y a rien à rapprocher.
- **Rapprochée** : transaction dénouée **sans exception de rapprochement ouverte** (`resolved_at IS NULL`). Une exception résolue par un analyste compte comme rapprochée ; une exception ouverte, non. `MISSING_LOCALLY` n'a par définition aucune transaction locale : elle n'entre dans aucun des deux comptes (elle reste visible dans `openReconciliationExceptions`).
- **Fenêtre** : transactions dont `created_at` est comprise entre le **début** du premier chargement enregistré (`MIN(started_at)`) et la **fin** du dernier (`MAX(loaded_at)`) dans `demo_dataset_loads`. Les deux bornes viennent de l'horloge de la base, la même que celle de `created_at` : une horloge applicative décalée de quelques secondes exclurait des transactions. Les activités créées après le dernier chargement (visiteurs de la démo) sont hors fenêtre, de sorte que le taux décrit le jeu de démonstration et pas un mélange avec des paiements d'essai.

`GET /v1/stats` renvoie les **deux comptages** (`settledTransactions`, `reconciledTransactions`) et les bornes de la fenêtre, pas un pourcentage : l'API n'arrondit rien, le client divise deux entiers exacts. Les comptages sont faits en SQL (`COUNT` avec filtre relationnel).

`reconciliation` vaut **`null`** — jamais 0 ni 100 % — dans trois cas : rôle `MERCHANT` (le rapprochement lui est réservé, comme `openReconciliationExceptions`) ; aucun chargement enregistré ; aucun chargement avec début connu (lignes antérieures à la colonne `started_at`, ajoutée en nullable car le registre est en ajout seul et aucun `UPDATE` n'est possible, ADR 0003). Dans ces cas l'interface affiche « Indisponible », ce qui est vrai.

## Ce que ce taux NE dit PAS
- Il ne mesure **pas** « confirmé par un relevé opérateur » : sans modèle de relevé (ADR 0008), une transaction sans exception n'est pas prouvée conforme, elle n'a simplement aucun écart **rapporté**. Dans la démo, les écarts sont injectés par le seed ; en production, un vrai moteur de rapprochement devra rapporter ces écarts, et c'est à ce moment que le taux prendra tout son sens.
- Il ne pondère pas par montant (compte de transactions, pas de FCFA).
- Il n'est pas un historique : c'est l'état courant des exceptions. Résoudre une exception fait monter le taux.

## Conséquences
+ Une définition exacte, reproductible à la main par une requête SQL, testée en e2e (transaction propre, avec exception ouverte, avec exception résolue, hors fenêtre, non dénouée).
+ Aucune estimation dans le front : la carte affiche un fait de la base ou « Indisponible ».
− Tant qu'il n'existe pas de moteur de rapprochement, le taux de la démo vaut « 100 % moins les écarts que le seed a volontairement créés » : c'est une illustration du calcul, pas une mesure de qualité opérateur.
− La fenêtre repose sur `demo_dataset_loads`. Si le seed est relancé sans remise à zéro, `MIN(started_at)` reste celui du premier chargement : la fenêtre s'élargit au lieu de se déplacer. La remise à zéro nocturne (`reset-demo-data.sql`) vide le registre et évite cette dérive.
