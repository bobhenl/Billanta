# apps/backend

NestJS REST API (OpenAPI-documented, plain REST — not tRPC): PostgreSQL +
Drizzle ORM, shared-schema multi-tenancy enforced by Postgres Row-Level
Security, billing webhook stubs, and the two API contracts the AI voice-to-
invoice microservice depends on.

See `docs/CZ-SK-Invoicing-SaaS-Blueprint.md` — §2 (tech stack), §3
(architecture), §4 (multi-tenancy/RLS), §5 (billing), §6 (AI microservice
contract), §9 (legal/liability audit-trail fields) — for the design this
skeleton implements.

## Status: scaffold, not a finished backend

Real business logic (ARES enrichment, ISDOC/PDF generation, invoice
numbering/issuance, real JWT verification, tenant signup bootstrap) is
intentionally left as `TODO`-commented stubs that throw
`NotImplementedException` (HTTP 501) — search for `TODO` across `src/`
for the full list. What IS meaningfully real in this scaffold:

- The Drizzle schema (`drizzle/schema.ts`) and RLS policy SQL
  (`drizzle/rls-policies.sql`).
- `src/tenancy/tenant-context.middleware.ts`'s `SET LOCAL`-via-reserved-
  connection pattern — the actual multi-tenancy enforcement mechanism, not
  just its shape.
- `POST /api/v1/invoices/drafts` and `POST /api/v1/internal/channel-links/verify` —
  shaped to interoperate with the already-implemented
  `apps/ai-service` caller (see "Known contract deviation" below), not with
  a hypothetical shape.
- `POST /api/v1/billing/stripe/webhook` — real `Stripe-Signature`
  verification, event handling, and `subscription_events`-keyed
  idempotency (`src/billing/`). See "Billing webhooks" below for what's
  still a stub (GoPay's actual HTTP calls) and a known RLS-related gap
  shared with `channel-links`.
- `SubscriptionActiveGuard` / `@RequireActiveSubscription()`
  (`src/billing/require-active-subscription.guard.ts`) — a real plan-
  gating guard, applied to `InvoicesController.createDraft` as the
  representative example (blueprint §5).
- `src/recurring-invoices/` — real CRUD over `recurring_invoice_templates`
  plus a real daily `@Cron` job that materializes due templates into actual
  `invoices`/`invoice_line_items` rows. See "Recurring invoices" below for
  what's genuinely implemented vs. deferred (invoice numbering).
- `src/email/` + `POST /api/v1/invoices/:id/send` + `InvoiceRemindersCron` —
  real Resend-backed invoice emailing and a daily overdue-payment-reminder
  digest. See "Invoice emailing + overdue-payment reminders" below for what
  is genuinely real vs. the one confidence caveat (an actual live send was
  never exercised against a real Resend account/domain).
- `src/bank-reconciliation/` — real CSV parsing, persistence, and an
  auto-match algorithm against issued invoices (exact variable-symbol match,
  or an amount+currency+due-date-window fallback), with real unit test
  coverage for the matching logic. See "Bank reconciliation" below for the
  exact CSV format, the matching algorithm's precision tradeoffs, and what's
  explicitly NOT implemented (live PSD2/open-banking, MT940 parsing).
- `src/backup-destinations/` — real per-tenant application-level data
  export (CRUD, AES-256-GCM secret encryption, HMAC-signed webhook
  delivery, a real hourly `@Cron` scheduler) plus a Google Drive OAuth/
  upload integration written from documented API knowledge but not
  exercised against live Google credentials, and an on-demand `local`
  destination that generates a real, queryable SQLite database file
  (`better-sqlite3`) instead of uploading anywhere, schedule-locked to
  `manual`. See "Per-tenant backup destinations" below for the full
  breakdown and the one confidence caveat, and for how this differs from
  the platform-wide `apps/backup` pg_dump sidecar.

## Known contract deviation (read this if wiring up apps/ai-service)

This module's original scaffolding brief specified a flatter, camelCase
`POST /api/v1/invoices/drafts` body (`counterpartyNameRaw`, `lineItems`,
etc). By the time this backend was scaffolded, `apps/ai-service` already
existed with a **real, working** call to a *different*, nested, snake_case
shape (`apps/ai-service/app/pipeline/schemas.py::DraftInvoicePayload`,
posted by `voice_to_invoice.py::create_draft_invoice`, explicitly documented
there as "REAL", not a stub). This backend's DTOs
(`src/invoices/dto/create-invoice-draft.dto.ts`,
`src/channel-links/dto/verify-channel-link.dto.ts`) match that real,
already-implemented shape instead — an interoperable contract beats a
prettier hypothetical one. Full explanation in the doc comments on those two
DTO files, including a second, smaller mismatch (`ai-service`'s bare
`telegram`/`whatsapp` channel identifier vs. this backend's
`ai_telegram`/`ai_whatsapp` `invoice_source` enum values, reconciled in
`InvoicesService.createDraft`).

`apps/ai-service`'s `enrich_with_ares()` also already expects an *implied*
backend endpoint, `POST /api/v1/contacts/ares-lookup`, that didn't exist
before this scaffold — see `ContactsController.aresLookup` (stubbed, 501)
for the placeholder that makes that dependency visible.

## Running

From the monorepo root (after `pnpm install` — not yet run against this
scaffold):

```bash
pnpm --filter @faktur/backend dev
```

Requires `DATABASE_URL` (see `.env.example` here and the root
`../../.env.example`) pointing at a Postgres 16 instance —
`docker compose up postgres` from the repo root starts one.

## Migrations (Drizzle Kit)

- `drizzle/schema.ts` is the source of truth for table shape.
- `drizzle/rls-policies.sql` is hand-written raw SQL (RLS policies aren't
  part of the generated Drizzle migration in this scaffold) — apply it once
  after running migrations:
  ```bash
  psql "$DATABASE_URL" -f drizzle/rls-policies.sql
  ```
- Generate a migration from schema changes: `pnpm --filter @faktur/backend db:generate`
- Apply migrations: `pnpm --filter @faktur/backend db:migrate`
- Browse data: `pnpm --filter @faktur/backend db:studio`

The app's own runtime DB connection must authenticate as a non-owner,
`NOBYPASSRLS` role — see the long comment at the top of
`drizzle/rls-policies.sql`. Migrations should run as a separate, more
privileged role (not yet wired up here — see `drizzle.config.ts`'s TODO).

## API docs

Swagger UI is served at `/api/docs` once the app is running (see
`src/main.ts`).

## Billing webhooks (Stripe + GoPay, blueprint §5)

### Required env vars

See the root `.env.example` for the full list; the ones this module reads:

| Var | Used for |
|---|---|
| `STRIPE_SECRET_KEY` | Constructing the `stripe` SDK client (`src/billing/stripe-client.provider.ts`) |
| `STRIPE_WEBHOOK_SECRET` | Verifying `Stripe-Signature` via `stripe.webhooks.constructEvent` (`BillingService.verifyStripeSignature`) |
| `GOPAY_CLIENT_ID` / `GOPAY_CLIENT_SECRET` | GoPay OAuth client-credentials token (TODO — not yet implemented, see `src/billing/gopay.client.ts`) |
| `GOPAY_GOID` | GoPay merchant/GoID, needed once `GopayClient`'s real API calls are implemented |

`GOPAY_WEBHOOK_SECRET` (present in `.env.example`) is currently unused by
this module: unlike Stripe, GoPay's notification callback isn't signed —
see "GoPay" below for why `GopayClient` calls back GoPay's API instead of
verifying a signature.

### Testing the Stripe webhook locally

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and log in
   (`stripe login`).
2. Run the backend (`pnpm --filter @faktur/backend dev`), default port 3000.
3. Forward events to the local webhook endpoint:
   ```bash
   stripe listen --forward-to localhost:3000/api/v1/billing/stripe/webhook
   ```
   The CLI prints a `whsec_...` value on startup — put that in your local
   `.env` as `STRIPE_WEBHOOK_SECRET` (it's a different secret per `listen`
   session than your dashboard's registered webhook signing secret).
4. In another terminal, fire a test event:
   ```bash
   stripe trigger checkout.session.completed
   stripe trigger customer.subscription.updated
   stripe trigger invoice.payment_failed
   stripe trigger invoice.paid
   ```
5. To confirm idempotent handling (blueprint §5 / the Verification Plan's
   item 5), resend the same event id twice — e.g. `stripe events resend
   <evt_id>`, or replay from the Stripe Dashboard's webhook event log — and
   confirm the second delivery logs "already recorded — skipping duplicate
   delivery" rather than double-applying the tenant status change.

Note: `stripe trigger` synthesizes an event against a *fictional* test
customer/subscription — `checkout.session.completed` is the only one of
these that carries a resolvable tenant id out of the box (via
`metadata.tenantId`, which you'd set when creating a real Checkout
Session; the CLI's synthetic event won't have it, so `BillingService`
will log `tenant-not-resolved` and skip, which is expected without a real
tenant/`stripe_customer_id` row in the DB to match against).

## Plans, free trial and paying for Billanta

Code: `src/billing/` (`plans.ts`, `plan-access.ts`, `plan.guard.ts`,
`subscription.*`, `admin-billing.controller.ts`, `bank-transfer.ts`),
migration `0051_trial_billing.sql`.

- **Effective plan** is computed on every read (`planSummary`): the best of
  a live Stripe subscription (`active`/`past_due`), a prepaid period
  (`prepaid_plan`/`prepaid_until`, from credits or a paid proforma) and a
  running trial, else free. Nothing flips when a trial ends.
- **Trial**: a company gets `TRIAL_DAYS` (default 14, 0 = off, max 90) of
  Plus, no card (`TRIAL_PLAN` / `DEFAULT_TRIAL_DAYS` in
  `src/billing/plans.ts`; the SQL and `apps/frontend/lib/plan.ts` copies are
  checked by `plans.spec.ts`). It is not started at sign-up but when the
  company first saves an IČO (Settings → Company, or an import that fills it
  in), counted from then. The rules are in `src/billing/welcome-trial.ts`:
  the IČO passes the checksum and exists in ARES / RPO; one trial per IČO
  ever (`trial_icos`); one per user account and per normalised e-mail of
  every owner (`trial_claims`, lowercased, `+tag` and Gmail dots removed,
  SHA-256); never for demo or classroom companies. `grant_welcome_trial`
  (SECURITY DEFINER, the only writer of both tables) enforces them
  atomically. So a re-signup with a new e-mail, a second company of the
  same person (`POST /me/tenants`) or a company with an IČO that already had
  a trial starts on Free: otherwise a new account every two weeks would be
  Plus for free forever. When it ends the company is on Free: data stays,
  features above Free are read-only. A promo code still works on top
  (`promo-logic.ts`): trial days extend it, a better plan's code upgrades
  it, free months of Plus or lower start after it.
  `TrialRemindersCron` (08:00 Prague) sends the 3-day, 1-day and "ended"
  notices to owners and admins in the bell, and by e-mail only when Resend
  is configured.
- **Limits** (`@RequirePlan`, `FEATURE_MIN_PLAN`): bank and PayPal sync, new
  API keys need Start, card payments need Plus, and free keeps 2 active
  recurring templates. Only companies created after 0051 are limited
  (`plan_enforced`). Nothing is deleted when a plan lapses: existing data
  stays readable, only creating or syncing more is refused with
  `plan_required`.
- **Card / wallets**: `POST /v1/billing/subscription/checkout` creates a
  Checkout Session in `subscription` mode **without
  `payment_method_types`**, so Stripe shows whatever the dashboard enables
  for the currency and device. `STRIPE_PAYMENT_METHOD_CONFIGURATION`
  (`pmc_...`) picks a specific configuration. `POST .../portal` opens the
  Customer Portal. The card subscription is the default and the cheaper
  way to pay. `POST .../cancel` and `POST .../resume` set or clear cancel
  at period end, and `POST .../interval` switches monthly/yearly on the
  same product with a new inline price (`proration_behavior:
  always_invoice`). Prices are inline `price_data`, so there are no Stripe
  Price ids to create. The webhook stores the subscription id, currency,
  period end and cancel date on the tenant (0063), so the panel needs no
  Stripe call to render.
- **Bank transfer** (a month or a year, CZK): `POST .../bank-transfer`
  with `months: 1 | 12` (default 12) issues a proforma from
  `PLATFORM_BILLING_*` at the monthly price or the yearly rate plus
  `BANK_TRANSFER_SURCHARGE_PERCENT` (`src/billing/plans.ts`, mirrored in
  the frontend's `lib/plans.ts` and checked by a spec), with a QR
  Platba code and a variable symbol (`YYYY` + 6-digit sequence). A platform
  admin (`PLATFORM_ADMIN_EMAILS`) checks the bank statement and calls
  `POST /v1/admin/billing/proformas/:id/mark-paid`, which extends
  `prepaid_until` by the proforma's months (calendar months, the day
  clamped to the month's end; from the current end while the same plan
  still runs, otherwise from today), counts the payment towards a referral
  reward and notifies the company. Nothing renews.

  Referral rewards (migration 0079): the inviter gets the invited company's
  first payment without VAT in credits, capped at 289 for both programmes
  (the approved accountant partner tier marks a vetted accountant, it does
  not pay more). It is held back first: a monthly plan
  releases it with its second paid invoice, a plan paid for a year (or a
  12-month proforma) after 30 days (`ReferralRewardsCron`, 08:30 Prague).
  A refund (`charge.refunded`) or cancellation before then voids it. Only
  `invoice.paid` counts on the Stripe side, never the checkout event. `PrepaidRemindersCron` (08:15 Prague) mails
  the company 14 and 3 days before `prepaid_until` through the outbox,
  with a renewal proforma (same plan and length as the last one, reused if
  one is already open) and its QR code attached. It skips companies with a
  running card subscription. The proforma is a payment request;
  issue the tax document for the payment in your own accounting.

### Stripe dashboard setup

1. **Settings > Payment methods**: turn on Cards, Apple Pay, Google Pay and
   Link. Turn on SEPA Direct Debit for EUR subscriptions. Hosted Checkout
   runs on Stripe's domain, so wallets need no domain verification there.
   Stripe's own bank transfer method is not offered for subscriptions in
   Checkout, which is why transfers go through our proformas.
2. **Settings > Billing > Customer portal**: allow updating the payment
   method and viewing invoices. Cancelling there (at the end of the
   period) can stay on; the billing panel offers it too.
   Leave plan switching off, the plan comes from Checkout metadata.
3. **Developers > Webhooks**: endpoint
   `https://<domain>/api/v1/billing/stripe/webhook` with
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`,
   `invoice.payment_failed` and `charge.refunded` (a refund voids a
   referral reward that is still held back). Put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.
4. Optional: a payment method configuration for Billanta only, its id in
   `STRIPE_PAYMENT_METHOD_CONFIGURATION`; Stripe Tax if you charge VAT.

### GoPay

GoPay's notification callback does not sign its payload the way Stripe
does — per blueprint §5 and GoPay's documented pattern, the callback only
identifies *which* payment changed, and the receiver is expected to call
back GoPay's API (`GET /api/payments/payment/{id}`, conceptually) to fetch
the authoritative, trustworthy status before acting on it.
`BillingService.handleGopayWebhook` implements that control flow (fetch
status -> resolve tenant -> idempotency check -> apply -> mark processed)
for real, but `src/billing/gopay.client.ts`'s actual HTTP call
(`GopayClient.getPaymentStatus`) is a **TODO stub that throws** — its
exact request/response shape (OAuth token endpoint, status field names,
which field identifies the payer for our `tenants.gopay_payer_id`
mapping) has **not** been verified against GoPay's live API reference
(https://doc.gopay.com/) and should not be treated as a working
integration until that verification happens.

## Recurring invoices

`src/recurring-invoices/` implements standing "issue an invoice like this
every N weeks/months/quarters/years" templates
(`recurringInvoiceTemplates` in `drizzle/schema.ts`):

- `RecurringInvoicesController` / `RecurringInvoicesService` — real CRUD
  under `POST/GET/PATCH /api/v1/recurring-invoices` plus
  `POST /api/v1/recurring-invoices/:id/deactivate`. Deactivation is a soft
  delete (`is_active = false`) — never a hard delete — because past
  invoices generated from a template must keep their provenance even after
  the standing arrangement is retired.
- `RecurringInvoiceGenerationService` — a real `@nestjs/schedule` `@Cron`
  job (`EVERY_DAY_AT_MIDNIGHT`, registered via `ScheduleModule.forRoot()`
  in `AppModule`) that scans every tenant for due templates
  (`is_active = true AND next_run_date <= today`) and, for each one,
  creates a new `invoices` row (`status = 'draft'`,
  `source = 'recurring'`) plus matching `invoice_line_items` rows from the
  template's `line_items_snapshot`, then advances `next_run_date` by the
  template's `frequency`/`interval_count`.
- **Cross-tenant scan, without bypassing RLS wholesale**: the job needs
  every tenant id before any single `app.current_tenant_id` can be set —
  the same chicken-and-egg shape `TenantBillingRepository` already solves
  for Stripe/GoPay lookups (see "Resolved" section below). Rather than
  connecting as a BYPASSRLS/superuser role, it calls a new narrow
  `SECURITY DEFINER` function, `list_tenant_ids()` (`drizzle/rls-policies.sql`),
  that returns only tenant `id`s. Once a tenant id is in hand, everything
  else — reading that tenant's due templates, writing the new invoice —
  runs inside the same `sql.begin()` + `set_config('app.current_tenant_id',
  ...)` transaction pattern as `TenantContextMiddleware`, so RLS is fully
  enforced per tenant for the actual data access.
- **Invoice numbering — deliberately deferred, not duplicated.**
  `InvoicesController.issue` (the endpoint that would allocate a sequential
  `invoice_number` from `invoice_number_sequences` at issue time, per
  blueprint §6 step 8/9) is still a `NotImplementedException` TODO stub, and
  `InvoicesService.createDraft` — the only other code path that creates an
  `invoices` row — likewise never sets `invoiceNumber`. Since there is no
  real numbering logic yet to reuse, `RecurringInvoiceGenerationService`
  does not invent its own: a generated recurring invoice leaves
  `invoice_number` unset, exactly like any other manually-created draft,
  until a future `issue` implementation allocates one for all of them
  alike.
- `src/recurring-invoices/schedule.ts` — the pure date-advancement
  (`advanceNextRunDate`) and due-template (`isTemplateDue`) logic, kept
  free of any DB/Nest dependency specifically so it has real unit test
  coverage (`schedule.spec.ts`) without a live database: weekly/monthly/
  quarterly/yearly math across various `interval_count`s (including month-
  end/leap-year overflow edge cases), and the "only active AND due
  templates are picked up" filter.

## Invoice emailing + overdue-payment reminders

Two features built on the client-portal/reminder columns added to
`invoices` (`publicToken`, `sentAt`, `lastReminderSentAt`, `reminderCount`)
and a new `email` column on `contacts` (nullable — a contact with no email
on file simply can't be emailed yet):

- **`POST /api/v1/invoices/:id/send`** (`InvoicesController.send` /
  `InvoicesService.sendInvoice`) — loads the invoice and its contact
  through the caller's normal RLS-scoped `req.tenantDb` (never the public
  `get_public_invoice_view` SECURITY DEFINER function, which exists only
  for the no-auth client-portal view), computes the invoice total from its
  `invoice_line_items` (`invoice-total.util.ts` — `invoices` itself has no
  stored total column, see `get_public_invoice_view`'s comment in
  `drizzle/rls-policies.sql`), sends it via `EmailService.sendInvoiceEmail`,
  and stamps `sent_at`. Returns `400` if the invoice has no contact, or the
  contact has no email on file.
- **`InvoiceRemindersCron`** (`src/invoices/invoice-reminders.cron.ts`) — a
  daily `@Cron("0 9 * * *")` digest (registered via the `ScheduleModule.forRoot()`
  already set up in `AppModule` for `RecurringInvoiceGenerationService`, not
  a second registration) that emails a reminder for every `status =
  'issued'`, past-due invoice that was never reminded or was last reminded
  7+ days ago (`isDueForReminder` in `invoice-reminders.util.ts` — a pure,
  unit-tested predicate for that rule), then increments `reminder_count`
  and stamps `last_reminder_sent_at`. One invoice/tenant failing (e.g. a
  Resend outage) is logged and skipped, not allowed to abort the rest of
  the day's sweep — it's simply retried on the next run since
  `last_reminder_sent_at` was never updated.
  - **Cross-tenant scan, without bypassing RLS wholesale**: reuses
    `list_tenant_ids()` (`drizzle/rls-policies.sql`,
    `InvoiceRemindersRepository.listAllTenantIds`) — the same SECURITY
    DEFINER function `RecurringInvoiceGenerationService` already added for
    this exact "daily job must scan every tenant" shape — rather than
    adding a second, overlapping SQL function. Once a tenant id is in hand,
    `findOverdueInvoicesForTenant` runs the real eligibility query inside
    the usual `sql.begin()` + `set_config('app.current_tenant_id', ...)`
    transaction, so RLS is fully enforced per tenant for the actual reads.
- **`src/email/email.service.ts`** — a thin Resend wrapper
  (`sendInvoiceEmail`/`sendPaymentReminderEmail`) rendering real, inline
  HTML (invoice number, amount, due date, and a link to
  `${NEXT_PUBLIC_SITE_URL}/i/${invoice.publicToken}` — the frontend's
  client-portal route). **Confidence note**: `new Resend(apiKey)` and
  `resend.emails.send({ from, to, subject, html })` were verified against
  the real, published `resend@6.26.0` type declarations while writing this
  file — not recalled from memory — but an actual live send was never
  exercised against a real Resend account/domain in this task (no API key
  available), so delivery behavior in practice is unconfirmed, the same
  caveat this README already holds `GopayClient`'s HTTP calls to.

### Required env vars

`RESEND_API_KEY` and `EMAIL_FROM` (root `.env.example`). Without them
backend mail stays queued in `email_outbox` and nothing is sent; the
worker logs one warning. Abuse reports (`sendPlatformEmail`) only log.

### Outbox, unsubscribe and bounces

All tenant mail goes through `EmailOutboxService` into `email_outbox`
(migration `0049_email_outbox.sql`, RLS per tenant). `EmailOutboxWorker`
runs every minute and claims due rows through the SECURITY DEFINER
`claim_email_outbox()`, so one worker sees every tenant without bypassing
RLS for anything else.

- **Account e-mails** (password reset, sign-in e-mail change) are queued by
  the frontend through the SECURITY DEFINER `enqueue_account_email()`
  (migration `0062_account_email_outbox.sql`). They have no tenant
  (`tenant_id` NULL, invisible to every tenant context), are always
  transactional, are claimed before tenant mail, and die as `expired` once
  `expires_at` (the link's lifetime) has passed. The daily sending caps in
  `src/abuse/` limit a company's mail to its customers and do not apply.

- **Retries**: 429, 5xx and network errors retry with backoff (1 min
  doubling, 6 h cap, jitter) up to `EMAIL_MAX_ATTEMPTS`; other 4xx go
  straight to `dead`. Rows older than `EMAIL_OUTBOX_MAX_AGE_HOURS` are
  marked dead instead of sent late. Each row has a unique
  `idempotency_key` and Resend gets `outbox-<id>` as its idempotency key,
  so a crash between send and finish does not send twice.
- **Batching and quiet hours**: activity notifications for one member
  merge into one queued e-mail for `EMAIL_BATCH_WINDOW_MINUTES` and wait
  out the member's quiet hours (default 21:00–7:00 Europe/Prague).
  Transactional mail (invoices, reminders, invitations, security alerts)
  goes out at once.
- **Unsubscribe**: non-transactional mail carries `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The token is
  HMAC-signed with a key derived from `JWT_SECRET`. Public endpoints:
  `GET/POST /api/v1/public/email/unsubscribe/:token`; the frontend page is
  `/<locale>/unsubscribe/<token>` and the one-click target
  `/api/email/unsubscribe/<token>`.
- **Bounces**: `POST /api/v1/webhooks/resend` verifies the Svix signature
  with `RESEND_WEBHOOK_SECRET` (503 when unset). Hard bounces and
  complaints add the address to `email_suppressions`. Queued mail to a
  hard-bounced address is dropped; after a complaint only transactional
  mail still goes out.
- **Weekly digest**: `WeeklyDigestCron`, Mondays 8:00 Europe/Prague, for
  members who turned it on in Settings → E-mailová upozornění.
- **Admin view**: `GET /api/v1/admin/email-outbox?status=&limit=`
  (`PlatformAdminGuard`): counts per status and the latest rows.

Optional tuning: `EMAIL_BATCH_WINDOW_MINUTES` (15), `EMAIL_MAX_ATTEMPTS`
(6), `EMAIL_OUTBOX_MAX_AGE_HOURS` (72), `EMAIL_OUTBOX_BATCH_SIZE` (50).

## Bank reconciliation (statement upload + auto-match)

`src/bank-reconciliation/` implements bank-statement reconciliation against
`bank_statement_imports`/`bank_transactions` (`drizzle/schema.ts`). Payments
reach Billanta in two ways only: the **Fio API** (below) and an **uploaded
statement** in one of three formats:

- **camt.053** XML (ISO 20022, every larger CZ/SK bank exports it);
- **GPC / ABO** (`.gpc`, `.abo`), the Czech fixed-width format, CP1250;
- **CSV** (described below).

The camt.053 and GPC parsers are pure functions in `@faktur/cz-compliance`
(`bank-statements.ts`); `statement-upload.ts` detects the format and keeps
incoming payments only. `bank_statement_source` records which format an
import came from (`csv`, `camt053`, `gpc`, `fio`; `mt940` is reserved and
unused).

### Duplicates

The same payment can arrive twice: Fio API plus an uploaded statement of the
same account, overlapping statements, or one file uploaded again.
`dedupe.ts` (`splitDuplicates`) drops a movement when

1. its bank id (`external_id`: `fio:<ID pohybu>`, `camt053:<account>:<ref>`,
   `gpc:<account>:<doc number>`) is already stored, or
2. a stored movement has the same day, amount, currency, VS and payer account
   (account compared in canonical form, so an IBAN and `prefix-number/bank`
   agree). Each stored row absorbs one incoming row only, so two identical
   payments on one day stay two. A stored row with an id from the same
   source never absorbs a row with another id from that source.

A stored row without an id that absorbs one with an id takes it over. The
import summary reports `duplicates`.

### Endpoints

| Endpoint | What it does |
|---|---|
| `POST /api/v1/bank-reconciliation/import` | Multipart upload (`file` field): `.csv`, `.xml` (camt.053), `.gpc`/`.abo`. Max 5 MB. Parses in-memory, discards the raw upload, persists one `bank_statement_imports` row + one `bank_transactions` row per line, then runs auto-match (see below) on every newly-created transaction. |
| `GET /api/v1/bank-reconciliation/transactions?status=unmatched\|matched\|ignored` | Tenant-scoped list, optionally filtered by status. |
| `POST /api/v1/bank-reconciliation/transactions/:id/match` | Manual override — body `{ "invoiceId": "<uuid>" }`. Links the transaction to a specific `status = 'issued'` invoice and marks it paid, same as an auto-match. For the leftovers the algorithm below correctly declined to guess on. |
| `POST /api/v1/bank-reconciliation/transactions/:id/ignore` | Marks a transaction `ignored` (e.g. a transfer that isn't an invoice payment at all — a refund, a bank fee, an owner's own transfer between accounts). |

### Expected CSV format

There is no single "the" Czech bank CSV export — Fio, ČSOB, Komerční banka,
and Raiffeisenbank all use different column names, order, and encoding — so
this module defines its own plain, explicit format rather than one specific
bank's, and documents it here:

- **Encoding**: UTF-8 (a leading UTF-8 BOM, common from Windows-based
  banking software, is stripped automatically).
- **Header row required**, exactly these six column names (order does not
  matter — columns are looked up by name, not position):

  ```
  date,amount,currency,variable_symbol,counterparty_account,counterparty_name
  ```

- **`date`** — `YYYY-MM-DD` (ISO 8601 calendar date, no time component).
- **`amount`** — a plain decimal number, `.` as the decimal separator, no
  thousands separators, no currency symbol. Positive for an incoming credit
  (a payment received), negative for a debit — debits are imported like any
  other row but will simply never match an invoice total (which is always
  positive).
- **`currency`** — a 3-letter ISO 4217 code (e.g. `CZK`, `EUR`).
- **`variable_symbol`** — optional (blank allowed), up to 10 characters
  (matches `invoices.variable_symbol`'s `varchar(10)`).
- **`counterparty_account`** / **`counterparty_name`** — optional free text
  (e.g. `"19-2000145399/0800"` / `"Novák Consulting s.r.o."`).
- Fields containing a comma must be double-quoted (`"..."`), with embedded
  quotes doubled (`""`) — standard RFC-4180-style quoting. Blank lines are
  ignored.

The parser also reads the usual Czech/Slovak bank exports (e.g. Fio's CSV)
without any editing:

- Czech/Slovak column names are recognised next to the English ones
  (`Datum`, `Objem`/`Částka`, `Měna`, `VS`, `Protiúčet`, `Kód banky`,
  `Název protiúčtu` …, compared without diacritics). A separate bank code
  column is joined to the account as `account/code`.
- Lines before the header (account summary, period) are skipped; the header
  is the first of the first 30 lines that has a date and an amount column.
- `,`, `;` or tab as the delimiter, `D.M.YYYY` dates, decimal commas,
  thousands separators (`1 500,00`, `1.234,56`) and a trailing currency code
  (`99,90 EUR`) are all accepted.
- Windows-1250 files are decoded when the upload is not valid UTF-8.

A sample in the plain format is served at
`/samples/bank-statement-sample.csv` (linked from the import screen).

Example file:

```csv
date,amount,currency,variable_symbol,counterparty_account,counterparty_name
2026-08-01,15000.00,CZK,1234567890,19-2000145399/0800,Novák Consulting s.r.o.
2026-08-03,-450.50,CZK,,,
2026-08-05,2500.00,EUR,2026080501,DE89370400440532013000,Musterfirma GmbH
```

The whole file is validated up front — if any row has an invalid date,
amount, currency, or an over-long variable symbol, the entire import is
rejected (HTTP 400, listing every bad row/line number) and nothing is
persisted, rather than silently skipping bad rows or half-importing a
statement.

### Auto-match algorithm and its precision tradeoffs

Implemented as a pure, DB-free function (`src/bank-reconciliation/matching.ts`
`findInvoiceMatch`), unit-tested directly (`matching.spec.ts`) against
hand-built candidate lists — no database or mocking required to exercise the
whole decision table:

1. **Variable symbol + amount**: if the transaction has a
   `variable_symbol` and exactly one `status = 'issued'` invoice (quotes
   excluded) has the same one (leading zeros ignored on both sides), it is
   matched only when the currency agrees and the amount equals what is still
   due (total minus `amount_paid`) to the cent. A partial payment, an
   overpayment or a payment in another currency is left `unmatched` with
   reason `amount_mismatch` for a human to decide. Two issued invoices with
   the same VS are `ambiguous`. The invoice is marked paid with `paid_at` =
   the bank's booking day.
2. **Fallback — amount + currency + due-date window**: if there's no
   variable-symbol match, look for `status = 'issued'` invoices with the
   same currency, a due date within **±60 days** of the transaction date,
   and a computed total (`invoices` has no stored total column — it's
   summed from `invoice_line_items`, including VAT, same as
   `invoice-total.util.ts`) equal to the transaction amount to the cent. If
   exactly one candidate satisfies all three, match it. The ±60-day window
   is a heuristic, not a guarantee: two unrelated invoices for the same
   round amount (e.g. two 5000 CZK invoices with due dates three weeks
   apart) can both legitimately fall inside it for the same payment — see
   the ambiguous case below for what happens then.
3. **Ambiguous or no match -> stays `unmatched`, never guessed.** Both the
   variable-symbol and the amount/date-window paths return "ambiguous"
   (rather than picking the first or an arbitrary candidate) whenever more
   than one invoice ties, and a warning is logged naming the transaction and
   import. This is the module's central design bias, and the reason the
   endpoints expose a manual match/ignore override at all: **a false "paid"
   mark on the wrong invoice is worse than a transaction that needs a
   30-second human decision** — precision over recall, explicitly, per the
   task this module was built against.

A partial payment matched by hand (`.../match`) is added to `amount_paid`
and the invoice stays issued; the next payment of the rest then matches
automatically. The amount/date fallback never considers an invoice without a
`due_date`.

## Automatic bank sync (Fio API)

`src/bank-reconciliation/bank-connections.*`, `fio-client.ts`, `bank-sync.cron.ts`.
A tenant owner/admin stores a read-only Fio API token (64 chars, "Pouze
sledovat účet") via `POST /api/v1/bank-reconciliation/connections`. It is
encrypted with `AI_KEY_ENCRYPTION_KEY` (falls back to
`BACKUP_CONFIG_ENCRYPTION_KEY`) and never returned.

- Fio keeps a server-side cursor ("zarážka") per token. We read with
  `last/{token}/transactions.json` and move the cursor with
  `set-last-id` / `set-last-date`. Fio allows one request per token every
  30 s for all of these together, so every sync makes exactly one request
  (`planFioStep`): when the cursor is in place it downloads, otherwise it
  only moves the cursor and answers `pending: true`; the movements come with
  the next sync.
- `bank_connections.fio_last_id` is the newest movement id we stored and
  `fio_cursor_ready` says whether Fio's cursor stands there. Creating a
  connection checks the token by putting the cursor 30 days back. If Fio
  reports a cursor we did not leave (`info.idLastDownload`, e.g. another app
  using the same token), the next sync rewinds to `fio_last_id`
  (`fioCursorAfterFetch`). Fio answers 422 for history older than 90 days
  without a strong authorisation: we then start again from a date at most
  89 days back (`history_locked`).
- `last_request_at` enforces the 30 s limit: the manual
  `POST .../connections/:id/sync` answers 429 (`bank_sync_too_soon`), the
  hourly `BankSyncCron` (over `list_tenant_ids()`) skips the connection.
- Only incoming payments are kept, with `external_id` `fio:<ID pohybu>`.
  New rows go through the same `persistAndMatch` and duplicate check as an
  upload. The token is decrypted only for the request and never logged;
  Fio errors carry fixed messages without the URL.
- `FIO_API_BASE_URL` overrides the API base, for a local mock in development.

## PSD2 bank sync (Enable Banking)

Other banks connect over PSD2 through [Enable Banking](https://enablebanking.com/docs/api/reference/),
a licensed account-information aggregator (`enable-banking-client.ts`).
GoCardless Bank Account Data, the usual free option, stopped accepting new
accounts in July 2025, so it is not used.

- Configure `ENABLE_BANKING_APP_ID` and the application's RSA private key
  (`ENABLE_BANKING_PRIVATE_KEY` with `\n` escapes, or
  `ENABLE_BANKING_PRIVATE_KEY_PATH`). Register
  `${NEXT_PUBLIC_SITE_URL}/bank/psd2-callback` as the redirect URL in the
  Enable Banking control panel, or set `ENABLE_BANKING_REDIRECT_URL`.
  Without these, `GET .../connections/psd2` reports `available: false` and the
  UI only offers Fio.
- Each request is signed with an RS256 JWT (`kid` = application id).
- Flow: `GET .../connections/psd2/banks?country=CZ` lists banks.
  `POST .../psd2/start` stores a `pending` row with a random `auth_state` and
  returns the bank URL. The bank redirects to `/bank/psd2-callback?code&state`,
  and the page calls `POST .../psd2/complete`. That creates the session,
  activates the row with the first account, and adds a row for every other
  account in the same consent. `reconnectId` renews an expired consent on the
  same row.
- Consent lasts at most 180 days, or less when the bank caps it
  (`maximum_consent_validity`). An expired or revoked consent sets
  `status = 'expired'` and notifies the tenant.
- PSD2 allows about 4 unattended reads a day per account. The hourly cron
  therefore reads a PSD2 account only every 6 h, and the manual sync is
  limited to one every 15 min (429 `bank_sync_too_soon`).
- Only booked incoming payments are kept (`CRDT`/`BOOK`). `external_id` is
  `psd2:<account uid>:<entry_reference>`, with a fingerprint as fallback. The
  variable symbol is read from the remittance text (`/VS/…`, `VS: …`, or a
  digits-only reference).
- Deleting the last connection of a consent also deletes the session at
  Enable Banking. Pending rows older than a day are removed by the cron.

Banks without PSD2 access still use the CSV import.

## PayPal sync (Transaction Search API)

`POST .../connections/paypal` with `{clientId, secret, sandbox, label}`
connects a PayPal business account (`paypal-client.ts`). The tenant creates
a REST app at developer.paypal.com and enables **Transaction search** in its
features. The credentials are checked with one reporting call (400
`paypal_credentials_invalid` or `paypal_reporting_disabled`), then stored
encrypted as JSON in `token_encrypted`.

- The hourly cron reads `GET /v1/reporting/transactions` in windows of at
  most 31 days (the API limit), 500 rows a page. The manual sync is limited
  to one a minute. PayPal publishes transactions up to about 3 h late; the
  3-day overlap of every sync picks them up.
- Only completed received payments are kept: event codes `T00xx`, status
  `S`, positive amount. `external_id` is `paypal:<transaction id>`, the
  counterparty is the payer's e-mail and name, and the variable symbol comes
  from `invoice_id`, `custom_field`, the subject or the note.
- The fee PayPal kept goes to `bank_transactions.fee`. When the payment is
  matched (automatically or by hand) and the fee is in the invoice currency,
  it is added to `invoices.payment_fees`, the same column the manual "net
  received" entry and Stripe card payments use.
- `PAYPAL_API_BASE_URL` overrides the endpoint (local mock). Otherwise the
  `sandbox` flag picks `api-m.sandbox.paypal.com` or `api-m.paypal.com`.

## Card payments from the invoice link (Stripe Checkout)

`src/card-payments/`. Each company connects its **own** Stripe account; the
money never passes through the platform. This is unrelated to the platform's
own subscription billing above (`STRIPE_SECRET_KEY`).

- `PUT /api/v1/tenants/me/card-payments {secretKey}` takes a secret
  (`sk_…`) or restricted (`rk_…`) key, verifies it against Stripe and stores it
  encrypted (`AI_KEY_ENCRYPTION_KEY`, falls back to
  `BACKUP_CONFIG_ENCRYPTION_KEY`). Only the last 4 characters are returned.
  A restricted key needs write on Checkout Sessions and read on Payment
  Intents, Charges and Balance.
- `POST .../enabled {enabled}` toggles the button, `DELETE` forgets the key.
- The public invoice view gets `cardPayment: true` for an issued invoice or
  proforma with something left to pay. `POST /api/v1/public/invoices/:token/card-checkout`
  creates a Checkout Session for the remaining amount and stores it in
  `card_payment_sessions`.
- No webhook is needed: on return the page calls `card-confirm`, and
  `CardPaymentsCron` re-checks open sessions every 10 minutes (sessions expire
  after 24 h). A paid session marks the invoice paid with Stripe's fee from the
  balance transaction, once (`UPDATE … WHERE status = 'open'`).
- Return URLs use `NEXT_PUBLIC_SITE_URL`.

Testing needs a Stripe test-mode key and Stripe's test card `4242 4242 4242 4242`.

## UBL / Peppol e-invoice export

`GET /api/v1/invoices/:id/ubl` renders an issued invoice as UBL 2.1 in the
Peppol BIS Billing 3.0 profile (EN 16931), built by
`generateUblInvoiceXml` in `@faktur/cz-compliance` from the same input as the
ISDOC export. Slovakia requires structured B2B e-invoices over Peppol from
1 January 2027.

- Only `document_type = invoice` (400 `ubl_invoice_only` otherwise).
- Totals are recomputed from the lines so the EN 16931 sum rules hold; a
  sub-unit difference to the stored total becomes `PayableRoundingAmount`.
- VAT categories: `S`/`Z` for VAT payers, `AE` for reverse charge, `O` for
  a supplier that isn't a VAT payer (then no VAT identifiers are written).
- `EndpointID` comes from the VAT number (EAS 9929 CZ, 9950 SK, …). Parties
  without one get none, and the access point has to supply it.
- Sending over Peppol needs an access point and is not implemented.

## Slovak company index

The SK half of the company typeahead used to ask RPO (api.statistics.sk)
live. From the VPS a name search took 6.6–8.7 s. Slovak companies now come
from three sources, in this order:

| Source | What it has | Speed | Licence |
|---|---|---|---|
| `sk_companies` (local copy of RPO) | name search and IČO, ~1 M active subjects | ms | RPO data, CC BY 4.0 |
| RÚZ (registeruz.sk open API) | IČO only, plus the **DIČ**, which RPO lacks | ~0.1 s per call, 2 per IČO | CC0 |
| live RPO API | name search and IČO | 2–9 s | CC BY 4.0 |

- **IČO**: if the index is usable, its answer is final, including "not
  found", and RÚZ only adds the DIČ. Otherwise RÚZ, then live RPO. RÚZ
  alone can't decide that a company is gone, because it lags RPO by weeks
  to months.
- **Name**: the index (pg_trgm GIN on `name_norm`, 2 s statement timeout).
  Live RPO is used only when the index is not usable.
- "Usable" means at least 500 000 rows and data no older than 10 days
  (`skIndexUsable`). Until the first import, or while the import is
  broken, everything works as before, only slower.

The API shape and the `?part=fast|slow` split of `GET /api/v1/contacts/search`
(and the public company lookup) stay the same. The slow half is just fast now.

### Where the data comes from

RPO publishes a bulk export in an Oracle object storage bucket
(`RPO_BATCH_URL` in `@faktur/cz-compliance`):

- `batch-init/init_YYYY-MM-DD_NNN.json.gz`: a full snapshot, made on the
  first Saturday of the month and uploaded about a day later. It has 23
  files, ~930 MB gzipped and 9.8 GB of JSON (2.29 M subjects, 1.04 M
  active). A snapshot is only taken once its `_list.txt` manifest exists.
- `batch-daily/actual_YYYY-MM-DD.json.gz`: the day's changes, ~1 MB,
  written at 03:00 UTC.
- The bucket keeps files for 45 days.

### The import

`importSkCompanies` (`src/contacts/sk-companies/`) does three things:

- It loads the newest snapshot when it is newer than the loaded one. It
  then deletes the rows the snapshot did not touch. This deletion is
  skipped, and the run fails, if the snapshot has under 500 k subjects or
  under 80 % of the current rows.
- It applies every daily delta after the snapshot. A dissolved subject is
  deleted.
- It saves progress after each file, so a failed run resumes where it
  stopped. If the deltas have a gap, it reloads the snapshot.

It streams one line at a time and writes in chunks of 1000. Streaming a
whole snapshot took 270 s and ~200 MB RSS on a dev machine, before any
database writes. A Postgres advisory lock stops the cron and a manual run
from overlapping. The table is global: no `tenant_id`, no RLS, like
`ares_cache`.

- **Cron**: `SkCompaniesCron`, daily at 06:15 Europe/Bratislava. A normal
  day is one small delta. It is on in production. Set
  `SK_COMPANIES_SYNC=off` to stop it, or `SK_COMPANIES_SYNC=on` to run it
  outside production.
- **CLI**: `--full` reloads the newest snapshot even if it is already
  loaded. The first run takes a few minutes, so run it by hand after
  deploying migration 0058 rather than waiting for the cron:

  ```bash
  # production (inside the running backend container)
  docker compose exec backend node dist/src/contacts/sk-companies/sk-companies-import.cli.js [--full]
  # dev, from apps/backend, with DATABASE_URL set
  node -r ts-node/register src/contacts/sk-companies/sk-companies-import.cli.ts [--full]
  ```

- **State**: `SELECT * FROM sk_companies_sync` shows the loaded snapshot,
  the last delta, the row count, when the last run finished and the last
  error.
- **Expected size**: 250–400 MB in Postgres, including the trigram index.
  This is an estimate, not a measurement.

## Per-tenant backup destinations

`src/backup-destinations/` implements a per-tenant, tenant-owner-configured
data export — **NOT the same feature as `apps/backup`** (the platform-wide
nightly `pg_dump` -> the founder's own Google Drive, via a `rclone` sidecar
in `docker-compose.yml`). The two "backup" features in this codebase are
deliberately different in every dimension that matters:

| | `apps/backup` (platform-wide) | `src/backup-destinations/` (per-tenant) |
|---|---|---|
| Who configures it | The founder, via `.env`/`rclone.conf` | Each tenant OWNER, from their own Settings page |
| Scope | The ENTIRE multi-tenant database (`pg_dump`) | Exactly one tenant's own data |
| How it reads data | Raw Postgres dump, bypasses the application entirely | Normal RLS-scoped queries (`req.tenantDb`/per-tenant `sql.begin()`), exactly like any other tenant-facing endpoint |
| Destination | The founder's own Google Drive, fixed | A destination each tenant connects themselves: their own Google Drive, a webhook URL they control, or an on-demand local SQLite download |
| Purpose | Disaster recovery for the whole platform | A tenant's own data portability/export |

If you're looking for the disaster-recovery pg_dump sidecar, see
`apps/backup/README.md` instead — everything below is about the per-tenant
feature.

### What it does

A tenant OWNER (see `OwnerOnlyGuard` — this is the one dashboard feature in
this codebase restricted to the `owner` role rather than open to every
tenant member) can connect a destination that periodically receives a JSON
export of THEIR tenant's own `invoices` (with `invoice_line_items`),
`contacts`, and `expenses` — queried through the exact same RLS-scoped
`tenantDb` every other tenant-facing endpoint uses, never a raw DB
connection. Three destination types:

- **`webhook`** — a URL the tenant controls. The export bundle is POSTed
  as JSON, signed with `X-Faktur-Signature: sha256=<hmac-hex>`
  (`webhook-signing.util.ts`) computed over the exact request body with a
  server-generated secret shown to the tenant exactly once at creation time
  (same reveal-once UX as `POST /api/v1/api-keys`) — this is this app's own
  Stripe/GoPay webhook-signature verification pattern
  (`BillingService.verifyStripeSignature`), just in the SENDING direction:
  here Faktur is the one signing an outbound payload for someone else to
  verify.
- **`google_drive`** — the tenant's own Google Drive, connected via a
  SEPARATE OAuth consent flow from NextAuth's "Log in with Google"
  (`GoogleDriveOAuthService`'s doc comment has the full explanation): it
  requests the narrower `drive.file` scope (write access to files/folders
  this app itself creates, not full Drive read access) with
  `access_type=offline&prompt=consent` to obtain a refresh token for
  unattended background access, reusing the same `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` already configured for sign-in — no second
  registered OAuth app needed.
- **`sftp`** — the tenant's own server, NAS or hosting over SFTP
  (`sftp.client.ts`, `ssh2-sftp-client`). Each run uploads the same SQLite
  file as `local` (`billanta-zaloha-<timestamp>.db`) into `sftp_path`,
  creating the folder if needed. Without a password we generate an ed25519
  key pair; the private half is stored encrypted in `configEncrypted`, the
  public half (`sftp_public_key`) is shown for the tenant's
  `authorized_keys`. The server's host key is pinned on the first upload
  (`sftp_host_fingerprint`, `SHA256:…`); a different key later fails the run,
  and changing host or port clears the pin. The host goes through the same
  `publicUrlProblem` check as webhooks (internal addresses are refused in
  production).
- **File encryption (`sftp`, `google_drive`)** — optional, with
  [age](https://age-encryption.org) (`age.util.ts`): either an `age1…`
  public key (`encryption_recipient`, we can't decrypt) or a passphrase
  (stored encrypted so scheduled runs can use it). Encrypted files get a
  `.age` suffix and open with `age -d -i key.txt file.age` or
  `age -d file.age`. `age-encryption` is ESM-only and is loaded with
  `import()`, which the CommonJS build turns into `require()` — that needs
  Node 20.19+ / 22.12+.
- **`local`** — an on-demand, real SQLite database file
  (`sqlite-export.service.ts`, using `better-sqlite3`) the tenant downloads
  directly through their browser — real tables (`invoices`,
  `invoice_line_items`, `contacts`, `expenses`, plus a single-row
  `export_metadata` header), populated via prepared statements, not a JSON
  blob in a single column, so the tenant can open it with any ordinary
  SQLite browser/tool and run real SQL against it. There is nothing to
  configure and nothing to authenticate against — `configEncrypted`,
  `webhookUrl`, and `googleDriveFolderId` are all left null for a `local`
  row. **Schedule-locked to `manual`**: `daily`/`weekly` are rejected at
  creation (`createBackupDestinationSchema`'s `.refine`) and at update
  (`BackupDestinationsService.update` looks up the existing row's type,
  since `type` isn't part of the update body) — there is no way to "push" a
  file to a browser download on a timer, a tenant has to actually be present
  to click download. The file is built in a temp file
  (`os.tmpdir()` + `crypto.randomUUID()`), read back into a `Buffer`, and the
  temp file is deleted immediately in a `finally` block (success or
  failure) — this server never accumulates tenant export files on disk,
  not even transiently.

### Endpoints

All under `JwtAuthGuard` + `OwnerOnlyGuard` except the OAuth callback:

| Endpoint | What it does |
|---|---|
| `POST /api/v1/backup-destinations` | Creates a `webhook` (`{ type: "webhook", webhookUrl, schedule }`), `sftp` (`{ type: "sftp", schedule, sftp: { host, port?, username, path?, password? } }`, answers with `sftpPublicKey` when no password is given) or `local` (`{ type: "local", schedule: "manual" }`) destination. Returns the plaintext signing secret for `webhook` only (a `local` row has no secret at all). `type: "google_drive"` is rejected here (400) — see the OAuth flow below. `type: "local"` with `schedule` other than `"manual"` is rejected (400) — see "What it does" above. |
| `GET /api/v1/backup-destinations` | Lists the tenant's destinations. Never returns `configEncrypted` or a decrypted secret. |
| `GET /api/v1/backup-destinations/google-drive/authorize` | Redirects to Google's consent screen (see above). |
| `PATCH /api/v1/backup-destinations/:id` | Updates `schedule`/`isActive`/`webhookUrl`/`googleDriveFolderId`, `sftp` (partial target) and `encryption` (`{ mode: "none" }`, `{ mode: "key", recipient }` or `{ mode: "passphrase", passphrase }`, `sftp`/`google_drive` only). Rejects (400) setting `schedule` to `daily`/`weekly` on an existing `local` destination. |
| `DELETE /api/v1/backup-destinations/:id` | Hard-deletes the destination (and, via `ON DELETE CASCADE`, its `backup_runs` history) — unlike `api_keys`' soft-revoke, there's no audit-retention requirement for a connection config. |
| `GET /api/v1/backup-destinations/:id/runs` | Lists export run history (`backup_runs`) for one destination. |
| `POST /api/v1/backup-destinations/:id/run-now` | Triggers an immediate export, using the exact same `ExportService.runDestinationExport` the scheduler calls — EXCEPT for a `type: "local"` destination, where this returns the generated SQLite file directly as the response body (`Content-Type: application/vnd.sqlite3`, `Content-Disposition: attachment`) instead of a JSON `backup_runs` row (`ExportService.runLocalDestinationExport`). A `backup_runs` row is still recorded either way. |
| `GET /api/v1/backup-destinations/google-drive/callback` | Google's OAuth redirect target. A SEPARATE controller (`GoogleDriveCallbackController`), deliberately NOT behind `TenantContextMiddleware`/`JwtAuthGuard` — same "no bearer token on this request" shape as `ChannelLinksController`/`PublicInvoicesController`. Tenant identity comes from a short-lived, signed `state` JWT instead (see `GoogleDriveCallbackController`'s doc comment). |

### Secret encryption — why AES-256-GCM, not a hash

`backup_destinations.config_encrypted` holds either the Google Drive
refresh token or the webhook HMAC secret. Unlike `api_keys.key_hash` (a
one-way SHA-256 digest — an API key only ever needs to be *verified*), a
refresh token must be presented back to Google and a webhook secret must be
used as a literal HMAC key — both need to be **decrypted**, which a hash
can never provide. `src/backup-destinations/encryption.util.ts` implements
real AES-256-GCM (authenticated encryption — tampering is detected, not
just theoretically prevented) keyed on `BACKUP_CONFIG_ENCRYPTION_KEY` (root
`.env.example` — a 32-byte hex key, e.g. `openssl rand -hex 32`), with real
round-trip/tamper-detection unit tests (`encryption.util.spec.ts`). Key
rotation is NOT implemented — rotating the key would require re-encrypting
every existing row, out of scope for this pass.

### Scheduler — reuses `list_tenant_ids()`, doesn't invent a new cross-tenant path

`BackupExportCron` (`backup-export.cron.ts`) runs hourly
(`@Cron(CronExpression.EVERY_HOUR)`, via the `ScheduleModule.forRoot()`
already registered once in `AppModule`) and, for each tenant, exports any
`daily`/`weekly` destination that's due (`isBackupDue`,
`backup-schedule.util.ts` — real, unit-tested pure predicate; `manual`
destinations never run on a schedule, only via `run-now`). Per this
feature's own spec, it reuses the exact cross-tenant-scan pattern
`RecurringInvoiceGenerationService`/`InvoiceRemindersCron` already
established rather than inventing a new one: `list_tenant_ids()`
(`drizzle/rls-policies.sql`, a `SECURITY DEFINER` function) enumerates
every tenant id, then each tenant's actual destinations/exports run inside
the normal `sql.begin()` + `set_config('app.current_tenant_id', ...)`
transaction — RLS fully enforced per tenant, no new SQL function added.

### The most important property: exports never cross a tenant boundary

`ExportService.buildExportBundle`/`runDestinationExport`
(`export.service.ts`) take a `TenantDb` — the same RLS-scoped Drizzle
instance (`req.tenantDb`, or a per-tenant `sql.begin()`-scoped instance for
the cron path) every other tenant-facing endpoint in this codebase uses —
and run plain `.select()` queries against `invoices`/`invoiceLineItems`/
`contacts`/`expenses`/`tenants` with **no manual `WHERE tenant_id = ...`
anywhere**. Postgres RLS (`tenant_isolation` policy, `FORCE ROW LEVEL
SECURITY`, `drizzle/rls-policies.sql`) is what actually restricts every one
of those queries to exactly the one tenant whose `app.current_tenant_id`
is set on that transaction — the same mechanism, not a parallel
reimplementation of it, that already protects every other tenant-facing
read/write path in this app (`TenantContextMiddleware`,
`RecurringInvoiceGenerationService`, `InvoiceRemindersRepository`). This
was verified by tracing both call sites end to end: `BackupDestinationsController
.runNow` passes `req.tenantDb` (populated only after
`TenantContextMiddleware` has confirmed the caller is a member of that
tenant); `BackupExportCron.runDueDestinationsForTenant` opens its own
`sql.begin()` + `set_config(...)` per tenant id from `list_tenant_ids()`,
mirroring `RecurringInvoiceGenerationService.generateForTenant` line for
line. Neither path ever calls `DbService.db` (the shared, tenant-agnostic
pool) for a tenant-scoped table, and neither ever passes a `tenantId`
string into a query's `WHERE` clause instead of relying on RLS.

### Confidence caveat — Google Drive/OAuth request shapes

`google-drive.client.ts` and `google-drive-oauth.service.ts` implement
Google's OAuth2 token endpoint and Drive v3 multipart upload against their
long-standing, publicly documented contracts — this is stable, widely-used
public API surface, not an obscure/undocumented one (contrast `GopayClient`
below, which flags genuine contract uncertainty). That said, and in the
same spirit of honesty this README already applies to `GopayClient` and
the Resend integration: these calls were written from documented knowledge
of the Google OAuth2/Drive v3 APIs, not exercised against a live Google
Cloud project in this task (no credentials available) — confirm against
https://developers.google.com/identity/protocols/oauth2 and
https://developers.google.com/drive/api/reference/rest/v3/files/create
before depending on this in production.

### Required env vars

`BACKUP_CONFIG_ENCRYPTION_KEY` (root `.env.example`) — see "Secret
encryption" above. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (already
present for NextAuth sign-in) are reused for the Drive OAuth flow.

## Public API (tenant-managed API keys)

A tenant can generate its own long-lived API keys (`src/api-keys/`) to call
select endpoints programmatically — e.g. creating or listing invoices from
an external system — without a human dashboard session.

### Base URL and authentication

```
https://<your-deployment>/api
Authorization: Bearer sk_live_<32 random characters>
```

Every request must carry the key as a standard bearer token. There is no
separate API-key header — it goes in the same `Authorization` header a
dashboard JWT would use.

### Managing keys

| Endpoint | What it does |
|---|---|
| `POST /api/v1/api-keys` | Generates a new key. Body: `{ "name": "My integration", "scopes": [] }`. **The full plaintext key is returned in this response only** — only its SHA-256 hash and a 12-character prefix (e.g. `sk_live_ab12`) are ever stored (`src/api-keys/api-key.util.ts::hashApiKey` — see that function's doc comment for why SHA-256 rather than bcrypt is the right choice for a high-entropy, machine-generated secret). If you lose the key, there is no way to retrieve it again — revoke it and generate a new one. |
| `GET /api/v1/api-keys` | Lists your keys: `name`, `keyPrefix`, `scopes`, `lastUsedAt`, `createdAt`, `revokedAt`. Never returns the full key or its hash. |
| `DELETE /api/v1/api-keys/:id` | Revokes a key (sets `revoked_at`). Soft-delete only, for audit purposes — a revoked key's name/prefix/usage history is preserved. |

These three management endpoints require a dashboard JWT (`JwtAuthGuard`) —
an API key cannot manage other API keys, including itself.

### Example endpoints callable with an API key

| Endpoint | What it does |
|---|---|
| `GET /api/v1/invoices` | List invoices for the key's own tenant. |
| `POST /api/v1/invoices/drafts` | Create an invoice draft (see `CreateInvoiceDraftDto` for the body shape — the same contract `apps/ai-service` uses). |

Both are wired up via `CombinedAuthGuard` (`src/auth/combined-auth.guard.ts`),
which accepts EITHER a dashboard/AI-service JWT OR an API key on the same
route — the rest of `InvoicesController` (`GET /:id`, `POST /:id/send`,
`POST /:id/issue`) remains JWT-only. An API key resolves its tenant
DIRECTLY from the key's own `tenant_id` column (`ApiKeysService.validateKey`,
via the `find_active_api_key_by_hash` SECURITY DEFINER function in
`drizzle/rls-policies.sql`) — no `tenant_memberships` lookup, since a key is
tenant-scoped by definition, not tied to a human's set of memberships.

### A note on how tenant context gets resolved for an API-key request

This matters if you're reading the code, not for calling the API. Nest's
request pipeline is middleware -> guards, and `TenantContextMiddleware`
(which every `InvoicesController` route runs through) unconditionally
verifies the bearer token as a JWT with no bypass for a differently-shaped
credential — so a guard alone can never "catch" an API-key request in time.
`ApiKeyOrJwtTenantContextMiddleware`
(`src/api-keys/api-key-or-jwt-tenant-context.middleware.ts`) is registered
ahead of `TenantContextMiddleware`, specifically for `InvoicesController`:
it delegates to `TenantContextMiddleware` UNCHANGED for any non-API-key
bearer token, and only steps in — resolving tenant context from the key's
own `tenant_id` and opening the identical `sql.begin()`/`set_config(...)`
transaction shape — when the token has the API-key format. See that file's
doc comment, and the doc comments on `ApiKeyAuthGuard`/`CombinedAuthGuard`,
for the full reasoning and an explicit note on the exact `req.user` shape
assumed (`{ id, email, tenantId, role }`) in case the concurrently-developed
JWT/tenant-membership resolution work changes that shape.

## Resolved: resolving a tenant before it's "known" (billing)

`TenantBillingRepository.findTenantIdByStripeCustomerId` /
`findTenantIdByGopayPayerId` run the same category of query
`ChannelLinksService.verify()` flags as unresolved for `channel_links`:
looking a tenant up by an external id (`stripe_customer_id`,
`gopay_payer_id`) necessarily happens *before* `app.current_tenant_id`
can be set, but `tenants` has `FORCE ROW LEVEL SECURITY` keyed on exactly
that setting — a plain pooled query with no tenant context matches zero
rows against a real RLS-enabled database.

Unlike `channel_links`, `tenants` holds real sensitive data (company
details, IČO/DIČ, addresses, subscription status), so a blanket RLS
exemption isn't an option here. Instead, both repository methods now call
narrow `SECURITY DEFINER` Postgres functions —
`find_tenant_id_by_stripe_customer_id` / `find_tenant_id_by_gopay_payer_id`
in `drizzle/rls-policies.sql` — that run with the table owner's
privileges but return only a single `uuid` for an exact external-id
match; `tenants`' RLS stays fully enforced for every other query. See the
"SECURITY DEFINER lookup functions" comment block in
`drizzle/rls-policies.sql` for the full safety reasoning, and its
"channel_links" comment block just above for why that table's fix (drop
RLS from the whole table) does not apply here. Everything *downstream* of
a resolved `tenantId` (the actual `tenants`/`subscription_events`
writes) **is** also genuinely RLS-safe: it reuses
`TenantContextMiddleware`'s `sql.begin` + `set_config(...)` pattern.
`channel_links`' own analogous ordering problem remains open — see
`ChannelLinksService.verify()`.

## Key files

| File | What it demonstrates |
|---|---|
| `drizzle/schema.ts` | Full multi-tenant schema (§4): `tenants`, `users` (extended with Auth.js's `name`/`emailVerified`/`image`), `tenantMemberships`, `contacts`, `invoices` (incl. §9 liability audit-trail fields `issuedByUserId`/`issuedAt`/`aiDraftReviewedAt`, and the client-portal/reminder fields `publicToken`/`sentAt`/`lastReminderSentAt`/`reminderCount`), `invoiceLineItems`, `invoiceNumberSequences`, `subscriptionPlans`, `subscriptionEvents`, `channelLinks`, `aresCache`, `tosVersions`, `tosAcceptances`. Plus, added for upcoming features: `accounts`/`sessions`/`verificationTokens` (Auth.js `@auth/drizzle-adapter` tables, user-level not tenant-scoped), `recurringInvoiceTemplates`, `expenses`, `apiKeys`, `bankStatementImports`/`bankTransactions`. |
| `drizzle/rls-policies.sql` | `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_id = current_setting('app.current_tenant_id')::uuid` policy per tenant-scoped table (now including `recurringInvoiceTemplates`, `expenses`, `apiKeys`, `bankStatementImports`, `bankTransactions`), `NOBYPASSRLS` runtime-role note, the `tenants`/`channel_links` bootstrap edge cases called out explicitly rather than papered over, the Auth.js tables' "no tenant_id, not RLS'd" note, and three `SECURITY DEFINER` functions: `find_tenant_id_by_stripe_customer_id` / `find_tenant_id_by_gopay_payer_id` (pre-tenant-context billing lookups) and `get_public_invoice_view` (the no-auth client-portal invoice lookup by `invoices.publicToken`) — all following the same narrow-door-through-intact-RLS pattern. |
| `src/tenancy/tenant-context.middleware.ts` | The enforcement mechanism itself: reserves one Postgres connection per request, opens a transaction, runs `set_config('app.current_tenant_id', ..., true)` (the parameterized equivalent of `SET LOCAL`), and hands a Drizzle instance bound to that same connection down as `req.tenantDb` — with a long comment on exactly why connection-pooling makes this non-optional. |
| `src/auth/jwt-auth.guard.ts` | Placeholder guard (shape only) with TODOs describing the two real caller classes it needs to distinguish: dashboard users (per-user JWT) vs. the AI microservice (a single static scoped service credential). |
| `src/invoices/invoices.controller.ts` | `POST /api/v1/invoices/drafts` — the AI microservice contract (§6): always `status = pending_review`, never allocates an invoice number, never auto-finalizes. |
| `src/channel-links/channel-links.controller.ts` | `POST /api/v1/internal/channel-links/{verify,activate}` (AI-service scope only, `ServiceTokenGuard`) and the tenant-scoped `GET/POST/DELETE /api/v1/channel-links` for Settings → Kanály (owner/admin writes, 30-min single-use codes, max 5 pending). |
| `src/billing/billing.controller.ts` + `billing.service.ts` | `POST /api/v1/billing/{stripe,gopay}/webhook` — real Stripe signature verification and `subscription_events`-keyed idempotency (§5); GoPay's control flow is real but `gopay.client.ts`'s HTTP call is a TODO stub — see "Billing webhooks" above. |
| `src/recurring-invoices/` | Real CRUD (`recurring-invoices.controller.ts`/`.service.ts`) over `recurringInvoiceTemplates` plus a real daily `@Cron` job (`recurring-invoice-generation.service.ts`) that materializes due templates into `invoices`/`invoice_line_items`, advancing `next_run_date` via the pure, unit-tested `schedule.ts` (`advanceNextRunDate`/`isTemplateDue`) — see "Recurring invoices" above, including how it scans all tenants without bypassing RLS (`list_tenant_ids()` in `drizzle/rls-policies.sql`) and why generated invoices leave `invoice_number` unset. |
| `src/email/email.service.ts` + `src/invoices/invoice-reminders.cron.ts` | Real Resend-backed invoice emailing (`POST /api/v1/invoices/:id/send`) and a real daily overdue-payment-reminder digest — see "Invoice emailing + overdue-payment reminders" above, including the Resend API-shape confidence note and the pure, unit-tested `isDueForReminder`/`computeInvoiceTotal` helpers (`invoice-reminders.util.ts`, `invoice-total.util.ts`). |
| `src/backup-destinations/` | Per-tenant backup/export destinations (`backup_destinations`/`backup_runs`) — real CRUD, AES-256-GCM secret encryption (`encryption.util.ts`, unit-tested), HMAC-SHA256 webhook signing (`webhook-signing.util.ts`, unit-tested), a real hourly `@Cron` scheduler reusing `list_tenant_ids()` (`backup-export.cron.ts`, `backup-schedule.util.ts` — unit-tested), a Google Drive OAuth/upload integration, and an on-demand `local` destination generating a real SQLite database file (`sqlite-export.service.ts`, `better-sqlite3`, unit-tested with a real generate-then-reopen-and-query round trip) instead of uploading anywhere, schedule-locked to `manual` — see "Per-tenant backup destinations" above for the full breakdown, the confidence caveat on the Google API shapes, and the table distinguishing this from the platform-wide `apps/backup` pg_dump sidecar. |
