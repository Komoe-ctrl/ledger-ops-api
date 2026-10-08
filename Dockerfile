# syntax=docker/dockerfile:1

# ==============================================================================
# Une seule image, réutilisée pour trois usages distincts (voir
# docs/DEPLOIEMENT.md) — chaque usage change seulement la COMMANDE et les
# variables d'environnement au niveau de la plateforme, jamais l'image :
#   - service web  : `node dist/main.js`         (APP_DATABASE_URL seulement)
#   - pré-déploiement : `npm run db:migrate`      (DATABASE_URL, rôle propriétaire)
#   - tâche planifiée : reset des données + seed  (DATABASE_URL + APP_DATABASE_URL)
#
# Pas de trim "production only" des dépendances : la tâche planifiée lance
# `scripts/seed-demo.ts` via `tsx` (jamais compilé par tsc, voir tsconfig.json
# — `include` ne couvre que `src/`), donc `tsx` doit être présent au runtime.
# Restructurer le build pour compiler aussi `scripts/` casserait la sortie
# `dist/main.js` déjà utilisée partout ailleurs — pas justifié pour une image
# de démo, où la taille n'est pas la contrainte.
# ==============================================================================

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# prisma.config.ts résout DATABASE_URL au chargement du fichier de config,
# même pour `generate` qui n'a besoin que du schéma, jamais d'une vraie
# connexion — valeur factice, uniquement dans cet étage de build (jamais
# copiée vers l'image finale).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
# scripts/*.ts importent "../src/..." et tournent via tsx (jamais compilés,
# voir plus haut) : tsx transpile à la volée depuis les sources TypeScript
# réelles, `dist/` seul ne suffit pas pour ces imports relatifs. tsconfig.json
# doit être présent pour que tsx applique experimentalDecorators/
# emitDecoratorMetadata — sans lui, les décorateurs class-validator plantent
# silencieusement à l'exécution (constaté en testant l'image, pas une
# supposition).
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json

# `npm run demo:reset` (service api-maintenance) appelle psql directement
# (scripts/reset-demo-data.sql) — absent de node:22-alpine par défaut.
RUN apk add --no-cache postgresql-client

# L'image officielle node:*-alpine fournit déjà un utilisateur non-root "node"
# (uid 1000) — pas besoin d'en créer un.
USER node

EXPOSE 3000

# Node 22 a fetch() en global : pas besoin d'installer curl dans l'image pour
# un simple sondage HTTP. La plateforme peut avoir son propre mécanisme de
# healthcheck (voir docs/DEPLOIEMENT.md) ; celui-ci reste utile en local
# (`docker run`) et sur tout orchestrateur qui lit HEALTHCHECK.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
