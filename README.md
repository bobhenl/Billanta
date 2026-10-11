# Faktur

A multi-tenant CZ/SK invoicing SaaS: Next.js dashboard, NestJS REST backend (Postgres + Drizzle + Row-Level Security), a Python/FastAPI AI voice-to-invoice microservice (Telegram/WhatsApp), and a shared `packages/cz-compliance` library (ARES lookup, ISDOC export, SPAYD QR, bank validation) ported from the MIT-licensed [Faktorio](https://github.com) project. Deployed via Docker Compose behind Caddy on a single Linux VPS.

Full architecture, tech stack, multi-tenancy design, billing, AI pipeline, security/GDPR, legal/liability strategy, and phased roadmap: **[docs/CZ-SK-Invoicing-SaaS-Blueprint.md](docs/CZ-SK-Invoicing-SaaS-Blueprint.md)**.

## Repo layout

```
apps/backend        NestJS REST API
apps/frontend        Next.js dashboard
apps/ai-service      FastAPI voice-to-invoice microservice
packages/cz-compliance   Shared TS compliance library (ARES, ISDOC, SPAYD QR, bank validation)
```

This is Phase 0 scaffolding only — app directories currently contain placeholder READMEs; no business logic has been implemented yet.

## Getting started

```bash
# 1. Install JS/TS dependencies across the workspace
pnpm install

# 2. Copy the env template and fill in real values
cp .env.example .env

# 3. Start infra services (Postgres, Redis, Caddy)
docker compose up -d postgres redis caddy

# 4. Run app dev servers (once apps exist)
pnpm dev
```

See the blueprint's §10 Phased MVP Roadmap for what comes next.
