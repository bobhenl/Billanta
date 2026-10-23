# Handoff – where to continue (2026-10-18)

Read `AGENTS.md` (root and per workspace) first. Branch `security-audit-fixes`.

## 1. Merge – DONE (2026-10-18)

Merged as d8e7767 and 75b2859 (with origin @ 0c02662), not pushed. The
remote took migration 0065 (`buyer_contact_person`), so the local ones are
`0066_blog_posts` and `0067_home_currency_rates`. Migrations 0048–0067, the
RLS file and the grants are applied to the local dev DB. The demo
playground (section 2) left no files, so it starts from zero and its
migration needs number 0068. The notes below are kept for reference.

Resolution decisions already taken (keep them):

- Remote features win where both sides built the same thing:
  - PAY by square: `paymentQrScheme` and `generatePayBySquareString` from
    `@faktur/cz-compliance/pay-by-square`. My older `generatePayBySquare` path
    and the `paymentDisclaimerSk` message were dropped.
  - Accountant directory (`accountant_listings`, migration 0050). My
    `listInAccountants` toggle, `public-accountants.controller.ts` and SQL
    `list_public_accountants` were removed (`DROP FUNCTION` in `rls-policies.sql`).
- Town pages (`invoicing/[slug]`) list accountants by region:
  `apps/frontend/lib/public-accountants.ts` provides `regionCode`, `regionLabel`
  and `accountantsForTown`.
- Home currency (EUR for SK at the ECB rate) is merged into their
  `ReportRates`:
  - `ReportRates` has a 4th constructor argument, `home`;
  - the jednotný kurz is CZK only;
  - `resolveRateMode({ home })` returns `ecb_daily`;
  - invoices store `getHomeRateDay(home, …).rate.toFixed(10)`.
- The invoice-side `annual` rate mode no longer exists (theirs). Annual is
  only a report mode. In SK the report section is hidden
  (`exchange-rate-settings.tsx`).

Remaining steps:

1. `pnpm --filter @faktur/cz-compliance build`, then
   `pnpm --filter @faktur/backend typecheck`,
   `pnpm --filter @faktur/frontend typecheck`, and
   `pnpm --filter @faktur/backend test` plus
   `pnpm --filter @faktur/cz-compliance test`. Fix what fails. Expected
   leftovers:
   - 10-decimal rate strings in `invoices.service.spec.ts`, e.g. line ~493
     should expect `"25.1200000000"`;
   - unused imports.
2. Check that `get_public_invoice_supplier_info` in `rls-policies.sql` matches
   the remote version and has no duplicate definition from my side.
3. Run `grep -rn "^<<<<<<<\|^>>>>>>>" apps packages`. It must be empty.
4. Run `git add -A` (but **not** `docs/research` drafts unless wanted, and
   not `.claude/launch.json`), then `git commit` (merge commit). Use git
   identity `-c user.name=bobhenl -c user.email=18662086+bobhenl@users.noreply.github.com`,
   with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. `git fetch` and merge `origin/security-audit-fixes` again if it moved.
6. Apply remote migrations 0048–0064, plus 0065/0066 (renamed from my
   0048/0049) and the RLS file, to the local dev DB **via psql**.
   `drizzle-kit migrate` fails silently because of CRLF hashes.
7. **Do not push** without asking the user.

## 2. Demo playground (agents launched in parallel, same checkout)

Goal:

- A public "Vyzkoušet demo" page. A visitor picks an account type and gets
  their own copy of a fictional company for 24 h.
- Abuse-proof: limits are enforced server-side, supplier identity is locked,
  there is a watermark, no emails are sent, AI has a quota of 5 per session,
  and demo creation is capped per IP.

| Package | Owns | Contract |
|---|---|---|
| A – dataset | `apps/backend/src/demo/dataset/**`, fictional `seed-dev.sql` | `seedDemoTenant(db, tenantId, variant, now?)`, `demoSupplier(variant)`, `DemoVariant = cz_payer \| cz_nonpayer \| cz_flat_tax \| sk_payer` |
| B – sessions | migration `0067_demo_playground.sql`, schema additions (`tenants.is_demo`, `demo_expires_at`, `demo_sessions`), `src/demo/demo.{module,service,controller}.ts`, cleanup job | `POST /api/v1/public/demo` → `{ loginToken, expiresAt }`; `POST /api/v1/auth/demo-login`; 429 `demo_ip_limit` / `demo_capacity` |
| C – guards | `src/demo/demo-guard.ts` plus hooks in the email, tenants, bank-accounts, PDF, public-invoices and AI code | error codes `demo_email_disabled`, `demo_readonly_*`, `demo_export_disabled`, `demo_ai_quota`, `demo_document_limit` |
| D – frontend | `/demo` marketing page, NextAuth provider `demo`, dashboard banner, read-only identity fields, demo banner on `i/[token]`, `demo` i18n namespace | see the contracts above |

The plan proposal from the planning agent is in
`docs/demo-playground-plan.md`, if it exists.

After the agents finish:

- Integrate their work: check that the contracts match, migration
  numbering, and `app.module.ts`.
- Run every typecheck and test.
- Do a manual run in the preview: create a demo for each variant, try to
  send an email, edit the IČO, create more than 30 invoices, make more than
  5 AI requests, and check the watermark on the PDF.
- Commit separately from the merge.

## 3. Other open items

- SK comparison pages: the research is in `docs/research/sk-competitors.md`.
  - Build in this order: SuperFaktúra, KROS, iDoklad (EUR cells), then
    Billdu.
  - Main finding: the SK locale currently shows Czech data (prices in Kč,
    links to `.cz` price lists).
  - The cell "ISDOC aj UBL (Peppol)" suggests Peppol delivery, which
    Billanta doesn't do. Reword it.
- Later cleanup: the `../Faktur-remote` worktree, the `faktur_remote` DB, and
  the extra `.claude/launch.json` entries.

## Rules worth repeating

- Never use the em dash "—"; use the en dash "–".
- Every user-facing string goes into cs/sk/en, with real Slovak. Edit the
  JSON with a parse/serialise script.
- AI never issues invoices. Never bypass RLS.
- No secrets in chat, logs or commits. Credentials are only in
  `.env.dev-login`.
- Don't deploy or touch the VPS without asking. Billanta on the VPS stays
  stopped.
- Don't delete the demo account. No real emails during tests.
