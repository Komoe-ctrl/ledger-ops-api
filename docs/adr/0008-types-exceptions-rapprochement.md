# ADR 0008 — Typage des exceptions de rapprochement au-delà de l'acquittement tardif

**Statut** : accepté · **Date** : 2026-09-29

## Contexte
ADR 0007 a volontairement scopé `reconciliation_exceptions` à un seul cas : l'acquittement opérateur tardif sur une transaction déjà `EXPIRED`, créé automatiquement comme effet de bord de `TransactionsService.transition()`. `reportedStatus` (un `TransactionStatus`) portait implicitement ce cas unique — "ce que l'opérateur prétend".

En construisant le jeu de données de démonstration (jalon 5), il fallait représenter des écarts de rapprochement d'une autre nature : une transaction présente chez nous mais absente d'un relevé opérateur, une transaction que le relevé mentionne mais que nous n'avons jamais vue, un écart de montant entre les deux systèmes. Aucun de ces trois cas n'a de "statut prétendu" au sens d'ADR 0007 — et le troisième (absente chez nous) n'a, par définition, aucune transaction locale à rattacher, alors que `transaction_id` était `NOT NULL`.

**Ce que cette décision NE fait PAS** : elle n'introduit ni modèle "relevé opérateur", ni moteur de diff, ni import de fichier. Ces trois cas sont rapportés un par un, explicitement, via un appel de service — pas détectés automatiquement. Construire un vrai moteur de rapprochement (comparer un relevé importé à nos transactions) reste un chantier séparé, non tranché ici.

## Décision
`reconciliation_exceptions` gagne une colonne `kind` (`ReconciliationExceptionKind` : `LATE_ACKNOWLEDGMENT`, `MISSING_IN_STATEMENT`, `MISSING_LOCALLY`, `AMOUNT_MISMATCH`), NOT NULL, backfillée à `LATE_ACKNOWLEDGMENT` pour les lignes existantes (seul cas que le système savait produire avant cette migration).

- `transaction_id` devient nullable. Contrainte `CHECK` : NULL si et seulement si `kind = MISSING_LOCALLY`.
- `reported_status` devient nullable. Contrainte `CHECK` : renseigné si et seulement si `kind = LATE_ACKNOWLEDGMENT`.
- Nouvelle colonne `detail` (texte libre, 500 caractères) : description de l'écart pour les 3 nouveaux types — pas de colonne dédiée par type (ex. pas de `reported_amount` distinct) : rester au plus simple pour un texte de constat, la décision de ce qu'il faut en faire reste humaine et passe par `resolution` à la résolution (inchangé depuis ADR 0007).

`ReconciliationService.reportDiscrepancy()` est le seul point d'entrée pour les 3 nouveaux types — jamais `LATE_ACKNOWLEDGMENT`, réservé au chemin automatique de `transition()`. Volontairement **pas exposé en HTTP** dans ce périmètre : consommé aujourd'hui uniquement par le script de seed de démo (jalon 5), pas par un endpoint admin/analyste. L'ajouter à l'API (et la question de qui a le droit de rapporter un écart) est laissé à un futur chantier de rapprochement réel.

## Conséquences
+ Un seul type d'exception, une seule table, une seule vue analyste (`GET /v1/reconciliation-exceptions`) pour tous les écarts — pas de fragmentation en plusieurs modèles.
+ Les contraintes `CHECK` empêchent en base une ligne incohérente (ex. `MISSING_LOCALLY` avec une transaction, ou `LATE_ACKNOWLEDGMENT` sans statut prétendu), cohérent avec ADR 0003.
− `detail` est un texte libre, pas structuré : un futur moteur de rapprochement qui voudrait, par exemple, requêter "tous les écarts de montant de plus de 1000 XOF" devrait soit parser ce texte, soit cette ADR devra être révisée pour ajouter des colonnes typées à ce moment-là.
