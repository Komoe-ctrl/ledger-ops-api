# ADR 0002 — Montants en entiers, unité mineure, sens porté par la direction

**Statut** : accepté · **Date** : 2026-09-22

## Contexte
Les nombres à virgule flottante (IEEE 754) ne représentent pas exactement les décimaux : `0.1 + 0.2 !== 0.3`. Sur des millions d'opérations, les écarts s'accumulent et rendent le rapprochement impossible.

## Décision
- Montants stockés en `BIGINT`, en **unité mineure** de la devise (XOF n'a pas de subdivision : 1 XOF = 1 ; pour EUR, 1 € = 100).
- Côté TypeScript : type `bigint`, jamais `number` pour un montant. Sérialisation JSON en **chaîne** (`"10000"`) pour ne pas perdre de précision.
- Montant **toujours positif** (`CHECK amount > 0`) ; le sens est porté par `direction` (DEBIT/CREDIT), jamais par le signe.
- Chaque montant est accompagné de sa devise ISO 4217 ; une écriture est mono-devise.

## Conséquences
+ Aucune erreur d'arrondi possible dans le stockage.
− Les calculs de commission en pourcentage imposent une règle d'arrondi explicite (à documenter au jalon 2 : arrondi au franc inférieur en faveur du marchand, par exemple).
