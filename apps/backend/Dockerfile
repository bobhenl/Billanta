# apps/backend/Dockerfile — NestJS API.
#
# Build context is the MONOREPO ROOT (see root docker-compose.yml's
# `build.context: .` for the `backend` service), because this workspace
# package depends on the sibling `@faktur/cz-compliance` package via the
# `workspace:*` protocol (apps/backend/package.json) — pnpm needs the whole
# workspace layout (root manifest + lockfile + every member's package.json)
# present to resolve and install it, even though only @faktur/backend and
# @faktur/cz-compliance actually get built into this image.
#
# Multi-stage:
#   deps       -> full (dev+prod) install, scoped via pnpm's "..." selector
#                 to @faktur/backend + its workspace dependencies.
#   build      -> compiles @faktur/cz-compliance then @faktur/backend
#                 (in that order — backend imports cz-compliance's build
#                 output, not its source).
#   prod-deps  -> same scope, --prod only, for a lean runtime node_modules.
#   runtime    -> prod node_modules + compiled dist/ only, no source/devDeps.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Every workspace member's package.json must be present for
# `--frozen-lockfile` to validate cleanly against pnpm-lock.yaml, even
# though `--filter` below only actually installs @faktur/backend and
# @faktur/cz-compliance (its workspace:* dependency).
COPY packages/cz-compliance/package.json packages/cz-compliance/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter "@faktur/backend..."

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/cz-compliance packages/cz-compliance
COPY apps/backend apps/backend
RUN pnpm --filter @faktur/cz-compliance build && pnpm --filter @faktur/backend build

# ---------------------------------------------------------------------------
# migrate — one-off job image (deploy/docker-compose.prod.yml `migrate`):
# needs drizzle-kit (a devDependency) and psql, so it builds on `build`.
# ---------------------------------------------------------------------------
FROM build AS migrate
RUN apk add --no-cache postgresql16-client && sed -i 's/$//' apps/backend/scripts/migrate.sh
CMD ["sh", "apps/backend/scripts/migrate.sh"]

# ---------------------------------------------------------------------------
# prod-deps
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/cz-compliance/package.json packages/cz-compliance/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --prod --filter "@faktur/backend..."

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=prod-deps /repo/node_modules ./node_modules
# No packages/cz-compliance/node_modules copy: that package declares zero
# runtime `dependencies` (only devDependencies — typescript, vitest, neither
# needed at runtime), so `pnpm install --prod` never creates a
# node_modules dir for it at all (verified: COPYing it fails the build with
# "not found" otherwise). Its compiled dist/*.js has no external runtime
# imports to resolve.
COPY --from=prod-deps /repo/apps/backend/node_modules ./apps/backend/node_modules

COPY --from=build /repo/packages/cz-compliance/package.json ./packages/cz-compliance/package.json
COPY --from=build /repo/packages/cz-compliance/dist ./packages/cz-compliance/dist

COPY --from=build /repo/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /repo/apps/backend/dist ./apps/backend/dist

WORKDIR /repo/apps/backend

# Matches the Caddyfile's `reverse_proxy backend:3001` — root
# docker-compose.yml sets PORT=3001 for this service to match. Note this
# differs from apps/backend's own non-Docker default (main.ts / .env.example
# both default PORT to 3000, matching what apps/ai-service's BACKEND_API_URL
# assumes for local, non-Docker dev where nothing else claims 3001); only
# the Docker network needs the override, applied via docker-compose's
# environment, not baked in here.
EXPOSE 3001

# dist/src/main.js, not dist/main.js: apps/backend/tsconfig.json's
# `include` covers both `src/**/*.ts` and `drizzle/**/*.ts` (a sibling of
# src, holding the Drizzle schema imported via `../../drizzle/schema` from
# inside src/), so TypeScript's inferred rootDir is apps/backend/ itself and
# `outDir: ./dist` preserves that shape (dist/src/..., dist/drizzle/...)
# instead of flattening src/ into dist/ directly — verified by an actual
# `nest build` run, not assumed. package.json's "start" script matches.
CMD ["node", "dist/src/main.js"]
