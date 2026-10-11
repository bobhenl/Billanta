# apps/frontend/Dockerfile — Next.js App Router dashboard, standalone output.
#
# Build context is the MONOREPO ROOT (root docker-compose.yml's
# `build.context: .`) — this is a pnpm workspace, so `pnpm install` needs
# the root manifest + lockfile + every member's package.json present even
# though only @faktur/frontend and its workspace dependency
# @faktur/cz-compliance get built into this image.
#
# Uses Next's `output: 'standalone'` (see next.config.mjs) so the runtime
# image only needs the traced minimal server + its pruned node_modules
# subset, not the full workspace node_modules tree.

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Every workspace member's package.json must be present for
# `--frozen-lockfile` to validate against pnpm-lock.yaml, even though
# `--filter` below only installs @faktur/frontend's own dependency tree.
COPY packages/cz-compliance/package.json packages/cz-compliance/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter "@faktur/frontend..."

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM deps AS build
# NEXT_PUBLIC_* values are inlined into the client bundle at build time.
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_PROFILE_DOMAIN
ARG NEXT_PUBLIC_CLARITY_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL     NEXT_PUBLIC_PROFILE_DOMAIN=$NEXT_PUBLIC_PROFILE_DOMAIN     NEXT_PUBLIC_CLARITY_ID=$NEXT_PUBLIC_CLARITY_ID
# lib/db.ts refuses to load without DATABASE_URL, and `next build` imports
# every route while collecting page data. The pool is lazy, so a placeholder
# is never dialled; it stays in this stage, not in the runtime image.
ENV DATABASE_URL=postgres://build:build@127.0.0.1:1/build
# The frontend imports @faktur/cz-compliance's build output, so it is
# compiled first (as in apps/backend/Dockerfile).
COPY packages/cz-compliance packages/cz-compliance
COPY apps/frontend apps/frontend
RUN pnpm --filter @faktur/cz-compliance build && pnpm --filter @faktur/frontend build

# ---------------------------------------------------------------------------
# runtime — standalone server + static assets only. No manual node_modules
# copy needed: `output: 'standalone'` already bundles its own pruned,
# trace-based node_modules alongside server.js.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/frontend

# Standalone output mirrors the monorepo path it was traced from — a real
# `next build` run here produces `.next/standalone/apps/frontend/server.js`
# plus a root-level `node_modules`/`package.json` one level up, NOT a flat
# `.next/standalone/server.js` (that flat layout only happens for a
# single-package, non-workspace Next.js app). `.next/static` and `public/`
# are never part of the standalone trace and must be copied in separately —
# see https://nextjs.org/docs/app/api-reference/config/next-config-js/output.
COPY --from=build /repo/apps/frontend/.next/standalone /repo
COPY --from=build /repo/apps/frontend/.next/static ./.next/static
COPY --from=build /repo/apps/frontend/public ./public

# Matches the Caddyfile's `reverse_proxy frontend:3000` and `next start`'s
# own default — no port override needed in docker-compose for this service.
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
