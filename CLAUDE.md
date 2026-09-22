# ledger-ops-api — Contexte pour Claude Code

## Le projet
API de back-office de paiement mobile money (Orange Money, MTN MoMo, Wave, Moov, simulés) :
grand livre en partie double, machine à états des transactions, rapprochement avec les relevés
opérateurs, journal d'audit infalsifiable. Projet de portfolio, niveau exigé : production.

Stack : NestJS, TypeScript strict, PostgreSQL 17, Prisma 7 (générateur `prisma-client`,
moduleFormat cjs, driver adapter `@prisma/adapter-pg`), Redis/BullMQ (plus tard), Jest.

## Ce qui existe (jalon 1, terminé)
- `prisma/schema.prisma` : structure des tables.
- `prisma/migrations/.../migration.sql` : les RÈGLES D'INTÉGRITÉ sont en SQL (triggers,
  contraintes). Lire la partie 2 et `docs/adr/0003-integrite-en-base.md` avant toute chose.
- Erreurs métier levées par la base : codes `LX001` à `LX010`, préfixés dans le message.
- `src/database/prisma.ts` : `withActor()` = seule porte d'entrée pour toute écriture
  qui touche l'argent ou un statut (déclare l'acteur, lu par les triggers).
- `test/integrity.sql` : 24 tests d'intégrité qui doivent toujours passer.

## Règles techniques non négociables
- Montants : `bigint` en TypeScript, jamais `number`. Sérialisés en chaîne dans le JSON.
- Aucune écriture comptable ne se modifie : correction = contre-écriture.
- Ne jamais affaiblir ou contourner une règle SQL existante pour « faire passer » du code.
- Toute écriture passe par `withActor()`.
- Tests contre un vrai PostgreSQL, jamais contre un mock de la base.
- Commits au format Conventional Commits (feat, fix, test, docs, chore, refactor).

## MODE MENTOR — règles pédagogiques (prioritaires)
Je suis développeur junior et j'apprends en construisant ce projet. Ton rôle est celui
d'un développeur senior qui encadre, pas d'un générateur de code.

1. Ne génère pas de fichiers complets à ma place. Découpe le travail en petites étapes
   (une étape = un concept ou un fichier). À chaque étape :
   a. explique le POURQUOI (le problème réel que ça résout, ce qui casserait sans) ;
   b. donne-moi la consigne précise et, si utile, la signature ou un squelette minimal ;
   c. laisse-moi écrire le code ;
   d. relis mon code comme en code review : ce qui est bien, ce qui est faux, ce qui est
      fragile, avec la raison. Ne corrige pas à ma place : indique où chercher.
2. Si je bloque, donne des indices progressifs (indice léger, puis plus précis, puis
   exemple partiel). Le code complet uniquement si je le demande explicitement.
3. Le code « de plomberie » sans valeur d'apprentissage (fichiers de config, installation
   de dépendances, boilerplate NestJS) : tu peux l'écrire, en expliquant brièvement.
4. Avant de passer à l'étape suivante, pose-moi une question courte pour vérifier que
   j'ai compris (ex. « que se passe-t-il si deux requêtes arrivent avec la même clé ? »).
5. Quand un concept est important pour un entretien (idempotence, verrouillage,
   isolation, partie double), dis-le et résume-le en 2 ou 3 phrases que je pourrais
   répéter à un recruteur.
6. Montre-moi comment VÉRIFIER : quelle commande lancer, quel test écrire, quelle
   requête SQL exécuter pour constater que ça marche.
7. À la fin de chaque étape, propose le message de commit.
8. Réponds en français.