# Déploiement — démo publique

Cible : Railway, PostgreSQL managé, une seule instance d'API. Ce document suppose le
`Dockerfile` à la racine du repo (jalon 5, étape 2.1) et couvre la configuration
spécifique à la plateforme — pas un fichier `railway.json` : la configuration-as-code
de Railway est en cours de dépréciation (coupure prévue au 2026-12-01) au profit d'un
nouveau format "Infrastructure as Code" encore mal connu au moment d'écrire ceci.
Configuration via le dashboard, documentée précisément ici.

## Vue d'ensemble

Une seule image Docker (voir `Dockerfile`), déployée sur **deux services Railway
distincts** dans le même projet :

| Service | Public ? | Variables | Rôle |
|---|---|---|---|
| `api` | oui | `APP_DATABASE_URL` seulement | sert le trafic réel |
| `api-maintenance` | non | `DATABASE_URL` + `APP_DATABASE_URL` | migrations + tâche planifiée |

**Pourquoi deux services et pas un `preDeployCommand`** : Railway documente que son
`preDeployCommand` tourne dans un conteneur séparé mais **avec les mêmes variables que
le service**. Y placer `DATABASE_URL` (rôle propriétaire) l'exposerait donc aussi au
service qui tourne en continu et sert du trafic public — exactement ce qu'ADR 0003 veut
éviter, même si le code applicatif ne la lit jamais. Chaque service Railway a son propre
jeu de variables, indépendant des autres : c'est cette séparation-là, pas une phase de
déploiement, qui donne la garantie recherchée.

`api-maintenance` n'a pas de domaine public attaché — rien ne l'expose à Internet.

## Base de données

Un PostgreSQL managé Railway (ou équivalent). Le rôle propriétaire (celui de l'URL de
connexion fournie par Railway) exécute les migrations ; la toute première migration
(`init_ledger`) crée les triggers et contraintes, et `least_privilege_app_role` crée le
rôle `ledger_app` lui-même — il n'existe pas tant que les migrations n'ont pas tourné au
moins une fois.

**Le Postgres managé Railway est privé par défaut** — aucune URL publique n'existe tant
qu'on ne l'active pas explicitement. Pour toute commande lancée **depuis son poste** (pas
depuis un service déployé sur Railway) qui a besoin de parler à cette base — rotation du
mot de passe `ledger_app`, requête ponctuelle, `bootstrap:admin-key` — il faut :
1. Service Postgres → Settings → Networking → activer **Public Networking** (TCP Proxy).
2. Attendre que ce service redéploie : Railway expose alors une variable
   `DATABASE_PUBLIC_URL` sur le service Postgres lui-même (pas sur `api`/`api-maintenance`).
   Elle n'existe pas avant ce redéploiement.
3. Utiliser cette URL publique pour la commande locale (en substituant le rôle/mot de
   passe si besoin — host et port sont ce qui change, pas les identifiants).
4. **Désactiver Public Networking une fois terminé** — la base ne doit pas rester exposée
   à Internet entre deux opérations ponctuelles.

**Piège à éviter** : `railway run --service X -- <commande>` exécute `<commande>`
**en local, sur son propre poste** — il injecte seulement les variables d'environnement
du service `X`, il n'ouvre aucun tunnel réseau vers le projet Railway. Si ces variables
contiennent l'hôte interne (`postgres.railway.internal`, injoignable depuis l'extérieur
du réseau privé Railway), la commande échoue avec une erreur de connexion, pas une erreur
Railway. `railway run` n'est donc utile ici que pour des commandes qui n'ont pas besoin
de joindre la base par son hôte interne — pour tout le reste, voir les 4 points ci-dessus.

## Configuration du service `api` (public)

**Variables** :
- `APP_DATABASE_URL` : construite avec les références de service Railway, pas une valeur
  copiée-collée — par exemple :
  ```
  postgresql://ledger_app:<mot de passe choisi à la rotation>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
  ```
  Railway résout `${{Postgres.PGHOST}}` etc. vers les valeurs réelles du service Postgres
  du même projet au déploiement. **Jamais un espace dans la valeur finale** — certains
  éditeurs de variables en insèrent un invisible en fin de ligne au collage, et
  `env.validation.ts` (`@IsUrl`) rejette alors la variable : l'app ne démarre pas, avec
  une erreur de validation au bootstrap qui ne dit pas "espace en trop" explicitement.
  Jamais `DATABASE_URL` sur ce service.
- `DATABASE_POOL_MAX` : `5` (ou selon les limites de l'offre Postgres utilisée).
- `CORS_ALLOWED_ORIGINS` : domaine(s) du front une fois déployé (ex.
  `https://ledger-ops-web.vercel.app`), séparés par des virgules.
- `PORT` : définir explicitement à `3000` — ne pas supposer une injection automatique par
  Railway (constaté en déploiement réel : pas systématique).
- `RATE_LIMIT_ENABLED` / `EXPIRATION_CRON_ENABLED` : ne pas définir (activés par défaut,
  c'est le comportement voulu en production).

**Commande de démarrage** : celle par défaut de l'image (`node dist/main.js`) — rien à
configurer.

**Domaine** : attacher un domaine public (Railway en fournit un par défaut,
`*.up.railway.app`, ou un domaine personnalisé).

**Healthcheck** : configurer le chemin `/health` dans les paramètres de déploiement du
service (Settings → Healthcheck Path). L'endpoint vérifie une vraie requête PostgreSQL,
pas seulement que le process tourne (voir `HealthController`).

**Piège à ne pas suivre pour vérifier une connexion** : les logs de démarrage affichent
`[PrismaService] Connexion PostgreSQL établie` — ce log **ne prouve rien**. Avec
l'adaptateur `@prisma/adapter-pg`, `$connect()` n'ouvre pas réellement de connexion
(lazy : la vraie connexion n'a lieu qu'à la première requête) — ce log apparaît même si
`APP_DATABASE_URL` est mal formée ou injoignable. Seule une vraie requête — `GET /health`,
qui exécute `SELECT 1` — prouve la connectivité. Ne pas se fier aux logs de démarrage pour
juger qu'un déploiement a réussi côté base de données.

## Configuration du service `api-maintenance` (interne)

Même repo/image que `api`, déployé comme un service Railway séparé dans le même projet.

**Variables** :
- `DATABASE_URL` : rôle propriétaire, construite de la même façon que `APP_DATABASE_URL`
  ci-dessous mais avec les identifiants du rôle propriétaire fournis par Railway.
- `APP_DATABASE_URL` : identique à celle du service `api` (même construction par
  référence, même mot de passe `ledger_app` après rotation — voir "Base de données"
  ci-dessus et l'étape de rotation dans "Premier déploiement").
- `DEMO_MERCHANT_API_KEY` / `DEMO_ANALYST_API_KEY` : valeurs fixes des clés de démo
  (format base64url, 43 caractères minimum — générer avec
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`,
  deux valeurs différentes). Sans elles, `npm run seed:demo` régénère une clé
  aléatoire à chaque remise à zéro nocturne et le README/le front se retrouvent
  avec une clé invalide le lendemain — avec elles, les mêmes clés survivent à
  chaque reset (voir `scripts/seed-demo.ts`, `resolveFixedApiKey`).

**Pas de domaine public.**

**Commande de démarrage** (Settings → Deploy → Custom Start Command) :
```
npm run demo:reset
```
C'est la commande que la tâche planifiée (ci-dessous) exécute. Un déploiement "normal"
de ce service (sans cron) lancerait donc aussi un reset — ce n'est pas un problème en
soi (idempotent), mais évite de redéployer ce service par erreur en dehors de la
tâche planifiée ou d'un besoin de maintenance explicite.

**Tâche planifiée** (Settings → Cron Schedule) : une expression crontab, par exemple
`0 3 * * *` (3h du matin, UTC). Railway exécute alors la commande de démarrage du
service selon ce planning plutôt qu'au déploiement.

## Premier déploiement

`railway run` ne convient à aucune étape ci-dessous qui parle à la base par son hôte
interne (voir le piège décrit dans "Base de données") — chaque étape qui a besoin
d'exécuter une commande dit explicitement si elle passe par un déploiement Railway
(hôte interne, fonctionne) ou par son poste (hôte public temporaire requis).

1. Provisionner le Postgres managé.
2. Créer `api-maintenance` (pas encore `api`) à partir du repo GitHub, avec
   `DATABASE_URL`/`APP_DATABASE_URL` construites par référence (voir plus haut) — le
   mot de passe `ledger_app` utilisé ici est encore `ledger_app_dev_only` à ce stade,
   ce sera corrigé à l'étape 4. Commande de démarrage temporairement réglée sur
   `npm run db:migrate`. Déployer.
3. Vérifier dans les **logs de ce déploiement** (pas `/health`, ce service n'expose rien)
   que les migrations se sont appliquées : la sortie de `prisma migrate deploy` liste
   chaque migration appliquée. C'est ce déploiement, tournant sur le réseau interne de
   Railway, qui crée le rôle `ledger_app` (migration `least_privilege_app_role`).
4. **Rotation immédiate du mot de passe `ledger_app`** — celui posé par la migration
   (`ledger_app_dev_only`) est public dans l'historique Git :
   1. Activer temporairement Public Networking sur le service Postgres (voir "Base de
      données").
   2. Depuis son poste : `psql "$DATABASE_PUBLIC_URL" -c "ALTER ROLE ledger_app PASSWORD '<nouveau mot de passe>'"`.
   3. Reporter ce même mot de passe dans `APP_DATABASE_URL` sur `api-maintenance`
      (variable à corriger maintenant) et, plus tard, sur `api`.
   4. Désactiver Public Networking.
5. Changer la commande de démarrage de `api-maintenance` à `npm run demo:reset`,
   redéployer. Sur une base juste migrée (donc vide), le `TRUNCATE` ne fait rien, puis le
   seed s'exécute normalement — ce déploiement sert donc aussi de premier seed.
6. Créer `api` avec les variables de sa section ci-dessus (mot de passe `ledger_app` déjà
   corrigé à l'étape 4), déployer. Vérifier `GET /health` (pas les logs de démarrage —
   voir le piège plus haut) et `GET /docs`.
7. Configurer la tâche planifiée sur `api-maintenance` (voir ci-dessus) pour les
   nuits suivantes.

## Nouvelle migration (mise à jour ultérieure)

Avant de redéployer `api` avec du code qui suppose une migration non encore appliquée,
sur `api-maintenance` : changer temporairement la commande de démarrage à
`npm run db:migrate`, déployer, vérifier dans les logs que la migration s'est appliquée,
puis remettre la commande à `npm run demo:reset` et redéployer. Un geste manuel en
plusieurs clics, pas une commande unique — `railway run` ne peut pas se substituer à un
vrai déploiement ici (voir "Base de données"), et c'est de toute façon explicitement
préféré à un `preDeployCommand` partagé qui exposerait `DATABASE_URL` au service public
(voir plus haut). Rare en pratique : la plupart des mises à jour ne touchent pas au
schéma.

## Action administrative ponctuelle

**Aucune clé ADMIN n'existe sur l'instance de démo** — décision explicite, cohérente
avec le fait que le seed ne crée jamais de clé ADMIN non plus. Les endpoints
d'administration (`POST /v1/merchants`, `POST /v1/api-keys`, ...) sont donc
inatteignables par construction sur la démo publique.

`APP_DATABASE_URL` du service utilise l'hôte interne : exécuter `bootstrap:admin-key`
depuis son poste suppose donc, là aussi, de passer temporairement par l'hôte public
(voir "Base de données" — `railway run` ne tunnelise rien).

Si une action admin ponctuelle est nécessaire (ex. créer un marchand supplémentaire) :
1. Activer temporairement Public Networking sur le service Postgres.
2. Construire localement une `APP_DATABASE_URL` identique à celle d'`api-maintenance`
   mais avec l'hôte/port publics (`DATABASE_PUBLIC_URL`) à la place des internes — même
   utilisateur `ledger_app`, même mot de passe, même base.
3. Depuis son poste, avec cette variable dans l'environnement local :
   ```
   npm run bootstrap:admin-key
   ```
4. Effectuer l'action nécessaire (via l'API déployée, avec la clé obtenue).
5. Révoquer la clé (`POST /v1/api-keys/:id/revoke`) une fois terminé.
6. Désactiver Public Networking.

## Vérification post-déploiement

- `GET https://<domaine-api>/health` → `{"status":"ok"}` — la seule preuve fiable que
  `APP_DATABASE_URL` fonctionne (voir le piège du log `$connect()` plus haut).
- `GET https://<domaine-api>/docs` → Swagger accessible publiquement.
- Avec la clé `MERCHANT` de démo : `POST /v1/payments` crée bien une transaction.
- `SELECT * FROM v_trial_balance_violations` (via le rôle propriétaire, donc Public
  Networking temporaire — voir "Base de données") → vide.
