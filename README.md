# Billanta

Multi-tenant invoicing SaaS for Czech and Slovak freelancers and small
companies, with the public site in Czech, Slovak and English. The repo and
package names still say `faktur`.

- Invoices, quotes and proforma invoices. QR payment (SPAYD), ISDOC and UBL,
  and checks for the fields Czech and Slovak law requires.
- ARES / RPO company lookup, payment reminders, recurring invoices and
  partial payments.
- Bank import and Fio sync with payment matching. Expenses, time tracking,
  VAT returns (EPO XML) and exports for accountants.
- Teams and roles, several companies per account, client portal, public
  company profile, API keys and webhooks.
- AI: drafts from voice (Telegram/WhatsApp) and from text or receipts. A
  human always issues the invoice.
- Growth: free guest invoice without sign-up, referral credits that pay for
  plans, accountant programme, partner directory with tracked links.

Architecture, data model, security and roadmap:
[docs/CZ-SK-Invoicing-SaaS-Blueprint.md](docs/CZ-SK-Invoicing-SaaS-Blueprint.md).

## Repo layout

```
apps/frontend           Next.js 15 (App Router, next-intl, NextAuth v5, Tailwind)
apps/backend            NestJS 11 REST API, Drizzle, Postgres with row-level security
apps/ai-service         FastAPI voice/text-to-invoice-draft service
apps/backup             nightly pg_dump sidecar (Google Drive)
packages/cz-compliance  shared TS: ARES, ISDOC, UBL, SPAYD QR, bank validation, tax dates
deploy/                 production on a single VPS (Docker Compose behind Caddy)
docs/                   blueprint, competitor comparison
```

Each workspace has an `AGENTS.md` with its rules (`CLAUDE.md` imports it).
Start with the root [AGENTS.md](AGENTS.md).

## Getting started

Needs Node >= 20.19, pnpm 9 and Docker.

```bash
pnpm install
cp .env.example .env                 # then fill in the values
docker compose up -d postgres redis
pnpm --filter @faktur/backend db:migrate
# then apply apps/backend/drizzle/rls-policies.sql and app-role-grants.sql
# with psql (see apps/backend/AGENTS.md)
pnpm --filter @faktur/backend dev
pnpm --filter @faktur/frontend dev   # http://localhost:3100
```

Marketing pages work without the backend. The dashboard needs it.

## Checks

```bash
pnpm --filter @faktur/frontend typecheck
pnpm --filter @faktur/backend typecheck
pnpm --filter @faktur/backend test
pnpm --filter @faktur/cz-compliance test
```

## Deploying

See [deploy/README.md](deploy/README.md). Images are built locally and
streamed to the VPS. `deploy/deploy.sh` runs the migrations, RLS policies and
grants before it restarts the stack.

Parts of `packages/cz-compliance` are ported from the MIT-licensed
[Faktorio](https://github.com/capaj/faktorio); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
