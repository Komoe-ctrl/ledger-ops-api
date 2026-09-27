# ADR 0007 — Acquittement opérateur tardif sur une transaction expirée

**Statut** : accepté · **Date** : 2026-09-27

## Contexte
Une transaction `PENDING` sans confirmation opérateur dans le délai imparti passe automatiquement à `EXPIRED` (jalon 3, expiration automatique). `EXPIRED` est un cul-de-sac dans `transaction_status_transitions` — aucune sortie, en particulier pas de `EXPIRED -> SUCCEEDED`.

En réalité, l'opérateur confirme parfois *après* ce délai (réseau lent, file d'attente côté opérateur). Sa confirmation tardive se heurterait à `LX005` (transition interdite) et, sans traitement particulier, disparaîtrait silencieusement. Or à ce moment-là, l'opérateur a bien de l'argent chez lui pour cette transaction — nous n'avons plus rien qui en garde une trace exploitable côté grand livre. C'est un écart réel entre deux systèmes, invisible tant que personne ne va chercher.

Le délai lui-même n'est qu'une estimation : 15 min par défaut (`PAYMENT_EXPIRY_MINUTES_DEFAULT`), configurable par opérateur (`PAYMENT_EXPIRY_MINUTES_<PROVIDER>`) — en réalité un push USSD expire plutôt entre 2 et 5 min selon l'opérateur, mais aucune source produit ne fixait de valeur précise au moment d'écrire ceci.

## Décision
`EXPIRED -> SUCCEEDED` **reste fermé** : on ne rouvre jamais automatiquement une transaction expirée pour y booker de l'argent, quelle que soit la confirmation reçue — ce serait une décision financière automatique sur un compromis, exactement ce que la base est censée empêcher (ADR 0003).

À la place : `PATCH /v1/transactions/:reference/status` détecte le cas `status actuel = EXPIRED` + `status demandé = SUCCEEDED` et, au lieu de tenter la mise à jour (qui échouerait en `LX005`), crée une **exception de rapprochement** (`reconciliation_exceptions`) capturant le désaccord — référence opérateur incluse si fournie — et renvoie une erreur `409` **distincte** de celle d'une transition interdite ordinaire (`ReconciliationRequiredException`, pas `LX005`) : celle-ci dit "le monde extérieur n'est pas d'accord avec nos registres", pas "tu as fait une erreur".

La résolution est **explicite, humaine, et journalisée** : `PATCH /v1/reconciliation-exceptions/:id/resolve` exige `resolvedBy` et une `resolution` (justification, jamais vide — vérifié à la fois côté API et par un `CHECK` en base). Une fois résolue, l'exception est figée (trigger `fn_reconciliation_exceptions_before_update`, LX006) — pas de seconde résolution, pas de réécriture.

**Ce que cette ADR ne tranche pas** : que faire *concrètement* de l'argent une fois l'exception résolue (booker manuellement une écriture correctrice, ignorer si l'opérateur avait tort, etc.) reste une action séparée, hors périmètre — cette fonctionnalité capture le désaccord et force une décision humaine explicite, elle n'automatise pas ce qui doit en découler.

## Conséquences
+ Aucun risque de booker de l'argent sur une base de confiance automatique envers un signal externe tardif.
+ Le désaccord est toujours visible et traçable (table dédiée, jamais supprimée), au lieu de disparaître dans un `409` générique que personne ne regarde.
+ Interne pour l'instant, comme la transition de statut — RBAC (qui peut résoudre) arrive au jalon 4.
− La résolution ne déclenche aucune action comptable automatique ; un analyste qui décide de booker quand même doit le faire par un autre moyen (hors périmètre de cette ADR).
