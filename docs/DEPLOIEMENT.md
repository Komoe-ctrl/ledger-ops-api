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

## Configuration du service `api` (public)

**Variables** :
- `APP_DATABASE_URL` : `postgresql://ledger_app:<mot de passe>@<host>:<port>/<db>` —
  jamais `DATABASE_URL` ici.
- `DATABASE_POOL_MAX` : `5` (ou selon les limites de l'offre Postgres utilisée).
- `CORS_ALLOWED_ORIGINS` : domaine(s) du front une fois déployé (ex.
  `https://ledger-ops-web.vercel.app`), séparés par des virgules.
- `PORT` : généralement injecté automatiquement par Railway.
- `RATE_LIMIT_ENABLED` / `EXPIRATION_CRON_ENABLED` : ne pas définir (activés par défaut,
  c'est le comportement voulu en production).

**Commande de démarrage** : celle par défaut de l'image (`node dist/main.js`) — rien à
configurer.

**Domaine** : attacher un domaine public (Railway en fournit un par défaut,
`*.up.railway.app`, ou un domaine personnalisé).

**Healthcheck** : configurer le chemin `/health` dans les paramètres de déploiement du
service (Settings → Healthcheck Path). L'endpoint vérifie une vraie requête PostgreSQL,
pas seulement que le process tourne (voir `HealthController`).

## Configuration du service `api-maintenance` (interne)

Même repo/image que `api`, déployé comme un service Railway séparé dans le même projet.

**Variables** :
- `DATABASE_URL` : rôle propriétaire.
- `APP_DATABASE_URL` : identique à celle du service `api`.

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

1. Provisionner le Postgres managé.
2. Créer les deux services (`api`, `api-maintenance`) à partir du même repo GitHub,
   avec les variables ci-dessus.
3. Déclencher un déploiement manuel de `api-maintenance` pour appliquer les
   migrations une première fois :
   ```
   railway run --service api-maintenance -- npm run db:migrate
   ```
   (ou via le dashboard : changer temporairement la commande de démarrage, déployer,
   la remettre à `npm run demo:reset` ensuite — `railway run` est plus direct si le
   CLI Railway est installé).
4. Lancer le seed une première fois (toujours sur `api-maintenance`, ou via
   `railway run`) :
   ```
   railway run --service api-maintenance -- npm run seed:demo
   ```
5. Déployer `api`. Vérifier `GET /health` et `GET /docs`.
6. Configurer la tâche planifiée sur `api-maintenance` (voir ci-dessus) pour les
   nuits suivantes.

## Nouvelle migration (mise à jour ultérieure)

Avant de redéployer `api` avec du code qui suppose une migration non encore
appliquée :
```
railway run --service api-maintenance -- npm run db:migrate
```
Un geste manuel, pas automatique — rare en pratique (la plupart des mises à jour ne
touchent pas au schéma), et explicitement préféré à un `preDeployCommand` partagé qui
exposerait `DATABASE_URL` au service public (voir plus haut).

## Action administrative ponctuelle

**Aucune clé ADMIN n'existe sur l'instance de démo** — décision explicite, cohérente
avec le fait que le seed ne crée jamais de clé ADMIN non plus. Les endpoints
d'administration (`POST /v1/merchants`, `POST /v1/api-keys`, ...) sont donc
inatteignables par construction sur la démo publique.

Si une action admin ponctuelle est nécessaire (ex. créer un marchand supplémentaire) :
1. Récupérer temporairement `DATABASE_URL`/`APP_DATABASE_URL` du projet Railway
   (dashboard → Variables).
2. Depuis son poste, avec ces variables dans l'environnement local :
   ```
   npm run bootstrap:admin-key
   ```
3. Effectuer l'action nécessaire (via l'API déployée, avec la clé obtenue).
4. Révoquer la clé (`POST /v1/api-keys/:id/revoke`) une fois terminé.

## Vérification post-déploiement

- `GET https://<domaine-api>/health` → `{"status":"ok"}`.
- `GET https://<domaine-api>/docs` → Swagger accessible publiquement.
- Avec la clé `MERCHANT` de démo : `POST /v1/payments` crée bien une transaction.
- `SELECT * FROM v_trial_balance_violations` (via le rôle propriétaire) → vide.
