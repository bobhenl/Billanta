# Billanta (repo `faktur`)

Multi-tenant CZ/SK invoicing SaaS. Brand name is **Billanta** (the repo and
package names still say `faktur`). Design and roadmap:
`docs/CZ-SK-Invoicing-SaaS-Blueprint.md`.

Each workspace has its own `AGENTS.md` with the rules for that part. Read it
before editing there.

| Path | What | Notes |
|---|---|---|
| `apps/frontend` | Next.js 15 App Router, next-intl, NextAuth v5, Tailwind | [AGENTS.md](apps/frontend/AGENTS.md) |
| `apps/backend` | NestJS 11 REST API, Drizzle, Postgres with RLS | [AGENTS.md](apps/backend/AGENTS.md) |
| `apps/ai-service` | FastAPI voice-to-invoice (Telegram/WhatsApp) | [AGENTS.md](apps/ai-service/AGENTS.md) |
| `apps/backup` | Nightly `pg_dump` sidecar to Google Drive | README only |
| `packages/cz-compliance` | Shared TS: ARES, ISDOC, UBL, SPAYD QR, bank validation, tax dates | [AGENTS.md](packages/cz-compliance/AGENTS.md) |
| `deploy` | Single-VPS Docker Compose behind the host's Caddy | [AGENTS.md](deploy/AGENTS.md) |

## Commands

pnpm 9 workspace + turbo, Node >= 20.19. Run from the repo root:

```bash
pnpm install
docker compose up -d postgres redis      # local infra
pnpm --filter @faktur/frontend dev       # http://localhost:3100
pnpm --filter @faktur/backend dev
pnpm --filter @faktur/frontend typecheck
pnpm --filter @faktur/backend typecheck
pnpm --filter @faktur/backend test       # vitest
pnpm --filter @faktur/cz-compliance test
```

Before you call a change done, run the typecheck (and tests) of every
workspace you touched.

## Rules that apply everywhere

- **Tenant isolation is enforced by Postgres RLS**, not by `WHERE` clauses.
  Never add a code path that bypasses it. See `apps/backend/AGENTS.md`.
- **AI never issues invoices.** AI features create drafts
  (`pending_review`). Issuing is always a human click in the dashboard.
- **Every user-facing string goes into all three locales**: `cs`, `sk` and
  `en` (`apps/frontend/messages/*.json`). Czech is the primary language.
  Write Slovak as real Slovak, not as Czech with a few words changed.
- **Secrets**: never commit `.env` files. Never print tokens, passwords or DB
  credentials in logs, commits or chat. Local dev credentials live in the
  gitignored `.env.dev-login`.
- **No copied competitor text.** Comparison pages describe competitors in
  our own words.
- Match the surrounding code: its comment density, naming and idiom.
  Comments explain *why*, not *what*.
- Commit messages: short imperative subject in English, body when the
  reason is not obvious.
