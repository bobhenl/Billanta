# Demo playground – implementation plan

## 0. Summary

A visitor clicks "Vyzkoušet demo", picks one of four account types and gets a real, separate tenant of their own. It is filled with fictional data dated relative to now and lives for 24 hours.

The demo reuses the normal path end to end: Auth.js database session, then the backend JWT, then `TenantContextMiddleware`, then RLS. It adds no new way to authenticate and no RLS bypass. Anything that crosses tenants (provisioning, quotas, cleanup lists) goes through narrow `SECURITY DEFINER` functions, the same way the existing code does.

Each restriction is enforced in several places:
- **Database triggers** are the final backstop.
- **Guards** in the app give clear error codes.
- **The UI** hides or disables what the demo can't do.

New environment variables, for both apps unless noted:

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_ENABLED` | `false` | Master switch, checked by the backend controller and the frontend route |
| `DEMO_PROVISION_SECRET` | – | Shared secret between the frontend server and the backend |
| `DEMO_IP_SALT` (backend) | – | Salt for the IP bucket hash |
| `DEMO_TTL_HOURS` | `24` | Demo lifetime |
| `DEMO_PER_IP_DAILY` | `3` | Demo creations per IP bucket per 24h |
| `DEMO_MAX_ACTIVE` | `500` | Global number of active demos |
| `DEMO_AI_PER_SESSION` | `5` | AI calls per demo |
| `DEMO_AI_PER_IP_DAILY` | `15` | AI calls per IP bucket per 24h, across sessions |

## 1. Data model – migration `0068_demo_playground.sql`

File: `apps/backend/drizzle/migrations/0068_demo_playground.sql`, plus an entry in `meta/_journal.json` (next `idx`, `when` greater than the 0066 entry). Mirror the columns in `apps/backend/drizzle/schema.ts`. Separate statements with `--> statement-breakpoint`, and keep every statement idempotent.

### 1.1 Columns
- `tenants.is_demo boolean NOT NULL DEFAULT false`
- `tenants.demo_expires_at timestamptz NULL`
- `tenants.demo_kind varchar(32) NULL`, with a CHECK that it is in `('cz_vat_sro','cz_freelancer','cz_pausal','sk_vat_sro')`
- `users.is_demo boolean NOT NULL DEFAULT false`
- A partial index `tenants_demo_expires_idx ON tenants(demo_expires_at) WHERE is_demo`

### 1.2 Global table `demo_sessions`
This table has no `tenant_id` policy and no grants to `faktur_app` (add `REVOKE ALL ON demo_sessions FROM faktur_app` to `drizzle/app-role-grants.sql`). It is reachable only through the definer functions below.

| column | type |
|---|---|
| id | uuid pk |
| tenant_id | uuid unique (no FK, so cleanup ordering stays simple) |
| user_id | uuid |
| kind | varchar(32) |
| ip_bucket | char(64) – sha256(salt + IPv4 /32 or IPv6 /64); no raw IP is stored |
| created_at, expires_at | timestamptz |
| ai_calls | int default 0 |
| cleanup_started_at, cleaned_at | timestamptz null |

Indexes: `(ip_bucket, created_at)` and `(expires_at) WHERE cleaned_at IS NULL`.

### 1.3 SECURITY DEFINER functions
All of these use `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC`, and `GRANT EXECUTE ... TO faktur_app` inside the existing `DO $$ IF EXISTS (pg_roles ...)` pattern.

1. **`create_demo_tenant(p_kind, p_ip_bucket, p_ttl_hours, p_per_ip_daily, p_max_active, p_tenant jsonb, p_bank jsonb) RETURNS TABLE(tenant_id uuid, user_id uuid, expires_at timestamptz)`**
   - Takes `pg_advisory_xact_lock(hashtext('demo_create'))`.
   - Counts `demo_sessions` for this `ip_bucket` in the last 24h, and active rows overall. It raises `demo_ip_limit` or `demo_capacity` (ERRCODE `P0001`, message equal to the code).
   - Inserts:
     - a `users` row: `is_demo=true`, email `demo-<uuid>@demo.billanta.invalid`, no password, `email_verified=now()` so verification gates don't block the visitor
     - a `tenants` row: `is_demo`, `demo_kind`, `demo_expires_at`, `plan_enforced=false`, `ai_mode='platform'`, and the identity fields from `p_tenant`
     - an owner `tenant_memberships` row
     - the `tenant_bank_accounts` rows from `p_bank`
     - the `demo_sessions` row
   - It does not call `bootstrap_tenant_for_user`. That means there are no `trial_claims` or `tos_acceptances`, so a demo never uses up a real trial.
   - The identity-locked rows are created here because the triggers in 1.4 forbid `faktur_app` from writing them for demo tenants.
2. **`consume_demo_ai_call(p_tenant_id uuid, p_per_session int, p_per_ip int) RETURNS int`** (calls remaining)
   - Takes `SELECT ... FOR UPDATE` on the session row.
   - Raises `demo_ai_quota` if `ai_calls >= p_per_session`, or if `SUM(ai_calls)` over the same `ip_bucket` in the last 24h is at or above `p_per_ip`.
   - Otherwise increments `ai_calls`.
3. **`demo_ai_calls_left(p_tenant_id uuid, p_per_session int) RETURNS int`** – a read-only helper for the banner.
4. **`claim_expired_demo_tenants(p_limit int, p_grace interval) RETURNS SETOF uuid`**
   - Runs `UPDATE demo_sessions SET cleanup_started_at = now() WHERE id IN (SELECT id ... WHERE expires_at < now() - p_grace AND cleaned_at IS NULL AND (cleanup_started_at IS NULL OR cleanup_started_at < now() - interval '30 minutes') ORDER BY expires_at LIMIT p_limit FOR UPDATE SKIP LOCKED) RETURNING tenant_id`.
   - This makes it safe when several backend instances run the cron.
5. **`finish_demo_cleanup(p_tenant_id uuid)`**
   - Deletes `users` rows where `is_demo` and the user has no remaining memberships. Their sessions and accounts go with them through the existing FK cascades.
   - Sets `demo_sessions.cleaned_at`.
   - It refuses to delete a user unless `is_demo` is true.
6. **`tenant_is_demo(p_tenant_id uuid) RETURNS boolean STABLE`** – used by the triggers.
7. **`public_invoice_demo(p_token uuid) RETURNS boolean`** – same shape as `public_invoice_blocked` in `rls-policies.sql`. Put it in `rls-policies.sql` next to `public_invoice_blocked`.
8. **Changes to existing functions:**
   - `list_tenant_ids()` in `rls-policies.sql`: change the body to `SELECT id FROM tenants WHERE NOT is_demo`. This one change keeps demo tenants out of all 8 cron scans:
     - `invoice-reminders.repository.ts`
     - `recurring-invoice-generation.service.ts`
     - `trial-reminders.cron.ts`
     - `weekly-digest.cron.ts`
     - `prepaid-reminders.cron.ts`
     - `backup-export.cron.ts`
     - `bank-sync.cron.ts`
     - `card-payments.cron.ts`
   - The QR-details and card-payment-target public functions used by `PublicInvoicesService.findByPublicToken` return NULL when the invoice's tenant is a demo.
   - `claim_email_outbox` (from 0062): re-create it in 0067 so it first runs `UPDATE email_outbox SET status='failed', last_error='demo_tenant' WHERE tenant_id IN (SELECT id FROM tenants WHERE is_demo) AND status='queued'`, and its claim query excludes demo tenants. Do the same for the account-level outbox claim from 0062: exclude users where `is_demo`.

### 1.4 Triggers (database backstop)
The trigger functions are **not** SECURITY DEFINER, so `current_user` is still the caller. Each one only enforces when `current_user = 'faktur_app'`, which lets the definer functions above still seed and clean up. Each calls `tenant_is_demo(...)`.

- **`demo_tenants_lock`** – BEFORE UPDATE ON tenants, when `OLD.is_demo`. Raises `demo_locked_field` if any of these columns is `IS DISTINCT FROM` its old value:
  - **Identity and address:** company_name, legal_name, ico, dic, vat_status, flat_tax_regime, activity_kind, address_*, email, phone, website, data_box_id, registry_note, logo_data
  - **Bank:** bank_account_number, bank_code, iban, swift, payment_methods
  - **Integrations:** ai_mode, ai_api_key_encrypted, stripe_secret_key_encrypted, card_payments_enabled, webhooks, public_profile
  - **Demo flags:** is_demo, demo_*
  - **Plan:** plan_enforced, trial_*, prepaid_*, subscription_*
  - **Abuse and referrals:** suspended_at, email_paused_at, referral_*

  It also raises on DELETE of a demo tenant by `faktur_app`. Cleanup is fine because `AccountDeletionService.wipe` deletes the tenant in a tenant tx, so cleanup has to go through a definer function – see 3.3.
- **`demo_bank_accounts_lock`** – BEFORE INSERT/UPDATE/DELETE ON tenant_bank_accounts. Raises `demo_locked_field`.
- **`demo_no_side_effects`** – BEFORE INSERT ON email_outbox, tenant_invitations, api_keys, channel_links, backup_destinations, bank_connections, and the webhook and card-payment session tables if they are separate tables. Raises `demo_disabled`.
- **`demo_row_cap`** – BEFORE INSERT ON invoices (300), contacts (200), expenses (200), time_entries (500), bank_transactions (300). Raises `demo_row_limit`. The count comes from an RLS-visible `SELECT count(*)`, which is fine because the tenant context is already set.

## 2. Cloning strategy – recommendation: TypeScript generator

| | SQL clone of a master tenant | TS generator (recommended) |
|---|---|---|
| RLS | Needs a definer function that reads another tenant's rows (a broad cross-tenant read) | Writes only into the new tenant through its own RLS tx |
| Relative dates | Must shift every date column, and is easy to get wrong (due dates, paid_at, ZF chains, time entries) | Dates are computed from `now` directly |
| Drift | The master tenant goes stale with each migration and nobody notices | Type-checked against `schema.ts`; it breaks at compile time |
| Totals, snapshots, numbering | Copied blindly | Built with the existing helpers (totals, `party-snapshot.ts`, number sequences) |
| Testability | Hard | Pure builders plus `*.spec.ts` |

**Layout:** everything lives in `apps/backend/src/demo/dataset/`.

| File | Contents |
|---|---|
| `kinds.ts` | `DemoKind`. `SUPPLIERS: Record<DemoKind, DemoSupplier>` holds the fictional company, IČO (valid mod-11), DIČ / IČ DPH, address, bank account and IBAN, home currency, `vatStatus`, `flatTaxRegime` |
| `rng.ts` | `mulberry32(seed)`, seeded per kind, so the output is deterministic and specs can snapshot it |
| `dates.ts` | `daysAgo(now, n)`, `daysFromNow(now, n)`, `startOfMonth(now)` |
| `contacts.ts` | `buildContacts(kind, rng)` – about 12 contacts across CZ, SK, DE, GB and US; emails `@*.example`, phones in the fictional range |
| `invoices.ts` | `buildInvoices(kind, now, contacts, rng)` – see the coverage list below |
| `expenses.ts` | `buildExpenses(kind, now)` – multi-currency expenses, some with VAT and some without, one created by AI (`pending_review`) |
| `bank.ts` | `buildBankData(kind, now, invoices)` – see the coverage list below |
| `time.ts` | `buildProjectsAndTime(now)` – 2 projects, billed and unbilled entries for "invoice from time" |
| `recurring.ts` | `buildRecurring(kind, now, contacts)` – 2 templates, monthly and quarterly, `next_run` in the future |
| `index.ts` | `buildDemoDataset(kind, now): DemoDataset` – plain objects only, no DB access |

`buildInvoices` covers:
- every status: draft, pending_review (`source='ai_telegram'`, `rawAiPayload`, `aiConfidenceScore`, `needsAttention`), issued (due later), issued and overdue (by 3, 20 and 65 days), partially paid (`amount_paid`), paid, cancelled
- proforma followed by ZF, and a credit note with `related_invoice_id`
- quotes (sent, accepted, expired)
- reverse charge for VAT payers: EU B2B to DE/SK with the matching `reverse_charge_code`, and CZ §92a construction
- currencies: CZK, EUR, USD and GBP with stored `exchange_rate*`, using fixed plausible rates and no CNB call
- the non-payer and paušál kinds have no VAT lines; the SK kind uses EUR home currency and PAY by square fields

`buildBankData` covers:
- one `bank_statement_imports` row
- matched transactions for the paid invoices
- unmatched transactions whose variable symbol matches an overdue invoice, so the visitor can try matching
- one transaction with a wrong amount
- one ignored transaction

**Writer:** `apps/backend/src/demo/demo-seed.service.ts` – `seed(tenantId, kind, now)`.
- It opens `dbService.sql.begin`, sets `set_config('app.current_tenant_id', tenantId, true)` (the `inTenant` pattern from `email-outbox.service.ts`), wraps the tx with `drizzleTx`, and inserts everything in FK order.
- Totals come from the same totals function `InvoicesService` uses. Seller and buyer snapshots come from `party-snapshot.ts`.
- `public_token` / `public_key` are generated the same way the invoices service generates them.
- `invoice_number_sequences` is set to the highest number used per series and period.

**Spec:** `dataset/dataset.spec.ts`, for each kind:
- every required state is present
- every email ends in `.example`
- IČO checksums are valid
- overdue invoices have `due_date < now`
- paid invoices have `paid_at <= now`
- no supplier or contact name matches a small denylist of real brands (the dev seed's Alza and Rohlik are an example of what to avoid)
- non-payer kinds have zero VAT

Before release, check every fictional IČO against ARES by hand and record the result in a comment in `kinds.ts`. The fictional bank accounts could belong to real people, so the payment QR is never rendered for demo tenants (see 4.10).

## 3. Demo authentication and lifecycle

### 3.1 Start
1. **Picker:** the visitor submits the kind picker on `/[locale]/demo`. The client calls `POST /api/demo/start` with `{ kind }`.
2. **Frontend route:** `apps/frontend/app/api/demo/start/route.ts`:
   - Returns 404 unless `DEMO_ENABLED`.
   - Checks that `Origin` matches the site origin (CSRF).
   - Calls `allow("demo-start:" + clientIp(request), ...)` from `lib/rate-limit.ts`, with a new `DEMO_LIMITS` entry (5 per 10 min).
   - If the request already has a session for a non-demo user, returns 409 `demo_signed_in`. This keeps the visitor's real account safe.
   - Calls the backend `POST /api/v1/public/demo/sessions` with headers `x-demo-provision-secret` and `x-guest-ip: clientIp(request)`.
3. **Backend controller:** `apps/backend/src/demo/demo.controller.ts` (`@Controller("v1/public/demo")`, pool only, not in `forRoutes`):
   - Compares the secret with `timingSafeEqual`.
   - Computes `ip = visitorIp(req.ip, req)` and turns it into an `ipBucket()` (`src/demo/ip-bucket.ts`, pure, with a spec).
   - Calls `DemoService.create(kind, ipBucket)`. That runs `create_demo_tenant(...)` with the supplier from `SUPPLIERS[kind]`, then `DemoSeedService.seed(...)`.
   - If seeding fails, it calls the cleanup path for that tenant right away.
   - Returns `{ userId, tenantId, expiresAt }`.
   - Definer errors map to HTTP 429 `demo_ip_limit` or 503 `demo_capacity`.
4. **Session:** the frontend creates the session with the existing wrapped adapter: `adapter.createSession({ sessionToken: randomUUID(), userId, expires: expiresAt })`. The wrapper stores only the hash.
   - It sets the Auth.js session cookie, using the same name and attributes `auth.ts` uses (`__Secure-` prefix on https).
   - It sets `billanta_tenant = tenantId` (`ACTIVE_TENANT_COOKIE` in `lib/api-client.ts`).
   - It returns `{ redirect: "/<locale>/dashboard" }`.
5. **After that, nothing is special:** `lib/backend-token.ts` mints the usual JWT (`sub`, `email`), the tenant comes from `X-Tenant-Id`, and `TenantContextMiddleware` checks membership and sets RLS.

### 3.2 During the session
- **Middleware:** `TenantContextMiddleware.handleDashboardUserRequest` adds `tenants.is_demo` and `demo_expires_at` to the existing membership select.
  - It sets `req.user.demo = { kind, expiresAt } | null`; extend `AuthenticatedUser` in the same file.
  - If `demo_expires_at < now()`, it throws `GoneException("demo_expired")`.
- **Tenant response:** `GET v1/tenants/me` returns `isDemo`, `demoKind`, `demoExpiresAt` and `demoAiCallsLeft`.
- **`auth.ts`:**
  - The `session` callback exposes `session.user.isDemo`, read from `users.is_demo`.
  - The `signIn` callback refuses OAuth sign-in or linking while the current session belongs to a demo user. Otherwise Auth.js database sessions would link a real Google account to a demo user that is about to be deleted.
  - Demo users cannot use credentials sign-in, because they have no password.
- **Account routes:** the frontend register, forgot-password, change-password, email-change and 2FA-setup routes refuse demo users with `demo_disabled`. Before showing `/register`, the visitor goes through `/api/demo/end`.
- **`app/api/demo/end/route.ts`** (POST, with an Origin check): deletes the current session through `adapter.deleteSession`, clears both cookies, and redirects to `?next=` (`/register` or `/demo`). The tenant itself is left for the cron.

### 3.3 Cleanup job
`apps/backend/src/demo/demo-cleanup.cron.ts` – `DemoCleanupCron`, `@Cron("*/15 * * * *")` (`ScheduleModule` is already registered), plus one run in `onApplicationBootstrap`. On each run:
1. `SELECT * FROM claim_expired_demo_tenants(50, '15 minutes')` over the pool.
2. For each tenant, run the existing wipe in a tenant tx. Extract a reusable `wipeTenantData(db, tenantId)` from `src/me/account-deletion.service.ts` (`wipe`). It already handles the ordering: null `related_invoice_id`, recurring templates, invoices, expenses, sequences, bank accounts, then the tenant, with the rest cascading.
   - The demo triggers block that tenant DELETE and the bank-account delete for `faktur_app`. So add `delete_demo_tenant_identity(p_tenant_id)` (definer, demo tenants only). It deletes `tenant_bank_accounts` and the `tenants` row after the RLS wipe has removed everything else. The data rows stay deleted under RLS; only these two identity steps run as the definer.
3. `SELECT finish_demo_cleanup(tenantId)` removes the demo user and its sessions.
4. Log counts only; never log ids together with IPs.
5. A per-tenant error is logged and skipped. The claim times out after 30 minutes, so the tenant is retried.

Also delete `demo_sessions` rows older than 30 days, from inside `finish_demo_cleanup` or a small definer function.

## 4. Guards – exact files and functions

| # | File | Function / change | Code |
|---|---|---|---|
| 4.1 | `apps/backend/src/tenancy/tenant-context.middleware.ts` | `handleDashboardUserRequest`: select is_demo / demo_expires_at, set `req.user.demo`, 410 on expiry; `AuthenticatedUser.demo?` | `demo_expired` |
| 4.2 | `apps/backend/src/demo/demo-policy.ts` (new, pure, plus `demo-policy.spec.ts`) | `demoBlockFor(method, path): DemoBlockCode \| null` (rules below) | `demo_disabled`, `demo_no_email` |
| 4.3 | `apps/backend/src/demo/demo.guard.ts` (new) | `DemoGuard.canActivate`: if `req.user?.demo`, call `demoBlockFor`, throw `ForbiddenException(code)`. Registered as a second `APP_GUARD` in `app.module.ts`, after `RoleAccessGuard`. `role-access.guard.ts`: export `guardPath` so both guards normalise paths the same way | – |
| 4.4 | `apps/backend/src/tenants/tenants.service.ts` | `update(db, id, role, dto)`: when the tenant is demo, compare each `DEMO_LOCKED_FIELDS` key in the dto with the current value and throw only on a real change, because settings forms send every field. `DEMO_LOCKED_FIELDS` is exported from `demo-policy.ts` | `demo_locked_field` |
| 4.5 | `apps/backend/src/abuse/sending-guard.ts` | `sendingBlock(tenant, sent)`: new first branch `DEMO_TENANT`. `assertCanSendEmail(db, tenantId)` also selects `isDemo` and maps it to `ForbiddenException("demo_no_email")`. This covers the callers at `invoices.service.ts` (send and remind), `invoice-reminders.repository.ts`, `buyer-details.service.ts` and `team.service.ts` | `demo_no_email` |
| 4.6 | `apps/backend/src/email/email-outbox.service.ts` | Private `isDemoTenant(db, tenantId)` inside `inTenant`. `enqueue`, `enqueueNotification` and, through `enqueue`, `enqueueDigest` return `null` without inserting and log at debug. The account-level enqueue from 0062 does the same for `users.is_demo` | (silent) |
| 4.7 | `apps/backend/src/ai/ai.service.ts` | New `consumeDemoQuota(tenantId)` runs `SELECT consume_demo_ai_call($1,$2,$3)` on **the pool** (`dbService.sql`), so the count is committed even if the request tx rolls back after the LLM call. Called at the start of the invoice-suggestion and receipt paths before `clientFor(...)`. `countPlatformUse` still applies. Natural-language search is local (`frontend/lib/nl-search.ts`) and needs nothing | `demo_ai_quota` (429) |
| 4.8 | `apps/backend/src/billing/plan-access.ts`, `plan.guard.ts` | `TenantPlanFields.isDemo`. `planSummary` returns the business plan with `source: "demo"` (extend `PlanSource`). `loadPlanSummary` selects `isDemo`. Frontend `lib/tenant.ts`: add `"demo"` to the PlanSource union | – |
| 4.9 | `apps/backend/src/me/me.controller.ts` | `createTenant` (POST v1/me/tenants) and DELETE v1/me: refuse when `users.is_demo`, read through the pool because the route is JWT-only with no tenant context | `demo_disabled` |
| 4.10 | `apps/backend/src/public-invoices/public-invoices.service.ts` | `findByPublicToken`: call `public_invoice_demo(token)` and set `PublicInvoiceView.demo`. QR and card-pay targets are already NULL from SQL | – |
| 4.11 | `apps/backend/src/invoices/invoice-pdf.service.ts` | Watermark and no QR (section 5) | – |
| 4.12 | `rls-policies.sql` `list_tenant_ids()` | Excludes demo tenants (1.3) | – |
| 4.13 | Triggers (1.4) | Backstop for all of the above | `demo_locked_field`, `demo_disabled`, `demo_row_limit` |

**Rules for `demoBlockFor`.** Admin areas are denied by default, so a new admin route is safe without extra work.
- **Allowed under `ADMIN_PREFIXES`:** any `GET` or `HEAD`; `PATCH v1/tenants/me` (field-filtered by 4.4); `PUT v1/tenants/me/number-formats`. Everything else under these prefixes returns `demo_disabled`: team, api-keys, billing, backup-destinations, PUT ai/settings, channel-links, referrals, logo, bank-accounts, card-payments.
- **Outside the admin prefixes:**
  - `POST v1/invoices/:id/send`, `:id/remind` and `:id/buyer-details-request` return `demo_no_email`. Team invitations are already blocked through the admin prefix.
  - Also blocked with `demo_disabled`:
    - `POST v1/invoices/import`, `import/bitfaktura`, `import/fakturoid`
    - attachment uploads
    - `v1/bank-connections/*`
    - `PUT` webhooks and `POST webhooks/:id/test`
    - accountant-listing writes
    - `GET v1/invoices/:id/isdoc`, `:id/ubl` – sendable e-invoices without a watermark
  - Accounting exports (Pohoda, Money S3, DPH and SK reports) stay allowed. The data is fictional, and they show the product well.
- **Spec:** a table-driven spec in `demo-policy.spec.ts` covering each rule and a few "allowed" cases: create invoice, mark paid, match a bank transaction, convert a quote.

## 5. Watermarks

- **PDF.** Add a new pure helper `apps/backend/src/invoices/invoice-pdf-demo.ts`: `demoWatermarkText(locale)` returns "DEMO – neplatný doklad" for cs and sk, and "DEMO – invalid document" for en.
  - In `InvoicePdfService.generate`, when `tenant.isDemo` (the `TenantRow` type picks this up from the schema), run `drawDemoWatermark(doc, text)` before `doc.end()`.
  - It loops over `doc.bufferedPageRange()` with `doc.switchToPage(i)`. On each page it does `save()`, rotates -35° around the page centre, draws the text at `fillOpacity(0.15)`, size about 60, in the Unicode font the service already registers, then `restore()`.
  - It also adds a small footer line on each page.
  - In the same path, `buildQrCode` returns null for demo tenants.
  - Guest invoices also call `generate`; they are never demo, so nothing changes for them.
- **Public page** `apps/frontend/app/[locale]/i/[token]/page.tsx`: when `view.demo`:
  - render a new `components/demo/public-demo-notice.tsx`: a fixed `Banner` with the `demo.publicNotice` text, plus a diagonal CSS watermark layer (`pointer-events-none`, theme tokens)
  - hide `card-pay-button`
  - set `generateMetadata` to `robots: { index: false, follow: false }`
  - Quote response and report-abuse stay available.
- **Other public routes** (`c/[token]`, `d/[token]`, `p/[slug]`): the public profile can't be enabled (locked by trigger and policy). The backend services behind `c/` and `d/` return 404 for demo tenants, using the same `public_invoice_demo`-style definer check keyed on their own token.

## 6. Frontend entry points and banner

- **Marketing CTA "Vyzkoušet demo":** in the hero, the pricing page and the login page footer. It links to `/demo` via `@/i18n/navigation`.
- **`app/[locale]/(marketing)/demo/page.tsx`:** a server page with `generateMetadata`. It renders `components/demo/demo-kind-picker.tsx` (client), which shows 4 cards with title, description and highlights.
  - Clicking a card POSTs to `/api/demo/start`, shows a loading state, then does `window.location.assign(redirect)`.
  - Errors are shown with `toast` using `errors.demo_*` and `rate_limited`.
  - It also shows the fictional-data note and a short terms line.
- **`app/[locale]/(marketing)/demo/expired/page.tsx`:** an explanation with CTAs for a new demo and for registering.
- **Banner:** `components/demo/demo-banner.tsx`, a client `Banner` placed at the top of the dashboard layout `app/[locale]/(dashboard)/layout.tsx`. It renders only when `tenant.isDemo`. It shows:
  - a countdown to `demoExpiresAt`, updated each minute
  - the AI calls left
  - "Založit vlastní účet", which POSTs `/api/demo/end?next=/register`
  - "Začít znovu", which POSTs `/api/demo/end?next=/demo`
- **`lib/api-client.ts`:** `apiFetch` / `apiFetchRaw` turn a 410 `demo_expired` into `redirect("/demo/expired")`. Add `isDemo`, `demoKind`, `demoExpiresAt` and `demoAiCallsLeft` to `TenantSettings` in `lib/tenant.ts`.
- **UI hints:**
  - Settings forms disable the locked fields and show the `demo.lockedField` hint.
  - The send and remind buttons are disabled, with a `demo.noEmail` tooltip.
  - Billing, team, API keys and integrations pages show `demo.featureDisabled`.
  - The server rejects these actions anyway, so this is only for clarity.

## 7. New i18n keys (`messages/{cs,sk,en}.json`)

| key | cs | sk | en |
|---|---|---|---|
| demo.cta | Vyzkoušet demo | Vyskúšať demo | Try the demo |
| demo.meta.title | Demo Billanta – vyzkoušejte bez registrace | Demo Billanta – vyskúšajte bez registrácie | Billanta demo – try without signing up |
| demo.meta.description | Vlastní ukázková firma na 24 hodin. | Vlastná ukážková firma na 24 hodín. | Your own sample company for 24 hours. |
| demo.page.title | Vyzkoušejte Billantu bez registrace | Vyskúšajte Billantu bez registrácie | Try Billanta without signing up |
| demo.page.subtitle | Dostanete vlastní kopii ukázkové firmy na 24 hodin a můžete ji libovolně upravovat. | Dostanete vlastnú kópiu ukážkovej firmy na 24 hodín a môžete ju ľubovoľne upravovať. | You get your own copy of a sample company for 24 hours and can change anything. |
| demo.page.fictional | Všechny firmy a osoby jsou smyšlené. | Všetky firmy a osoby sú vymyslené. | All companies and people are fictional. |
| demo.page.terms | Demo nikdy neodesílá e-maily a po 24 hodinách se smaže. | Demo nikdy neodosiela e-maily a po 24 hodinách sa vymaže. | The demo never sends emails and is deleted after 24 hours. |
| demo.kinds.cz_vat_sro.title | s.r.o. – plátce DPH | s.r.o. – platiteľ DPH (CZ) | Czech company – VAT registered |
| demo.kinds.cz_vat_sro.description | DPH, přenesená daňová povinnost, zálohy a cizí měny. | DPH, prenesenie daňovej povinnosti, zálohy a cudzie meny. | VAT, reverse charge, proformas and foreign currencies. |
| demo.kinds.cz_freelancer.title | Freelancer – neplátce DPH | Freelancer – neplatiteľ DPH (CZ) | Freelancer – not VAT registered |
| demo.kinds.cz_freelancer.description | Jednoduché faktury, výkazy času a opakované fakturace. | Jednoduché faktúry, výkazy času a opakovaná fakturácia. | Simple invoices, time tracking and recurring billing. |
| demo.kinds.cz_pausal.title | OSVČ s paušální daní | SZČO s paušálnou daňou (CZ) | Sole trader with flat-rate tax |
| demo.kinds.cz_pausal.description | Přehled příjmů pro paušální režim. | Prehľad príjmov pre paušálny režim. | Income overview for the flat-rate regime. |
| demo.kinds.sk_vat_sro.title | Slovenská s.r.o. – plátce DPH | Slovenská s.r.o. – platiteľ DPH | Slovak company – VAT registered |
| demo.kinds.sk_vat_sro.description | Faktury v eurech s PAY by square. | Faktúry v eurách s PAY by square. | Euro invoices with PAY by square. |
| demo.start | Spustit demo | Spustiť demo | Start demo |
| demo.starting | Připravujeme vaši ukázkovou firmu… | Pripravujeme vašu ukážkovú firmu… | Preparing your sample company… |
| demo.banner.title | Prohlížíte si demo | Prezeráte si demo | You are using the demo |
| demo.banner.expiresIn | Demo vyprší za {time} | Demo vyprší o {time} | The demo expires in {time} |
| demo.banner.aiLeft | Zbývající AI požadavky: {count} | Zostávajúce AI požiadavky: {count} | AI requests left: {count} |
| demo.banner.signUp | Založit vlastní účet | Založiť vlastný účet | Create your own account |
| demo.banner.restart | Začít znovu | Začať odznova | Start over |
| demo.expired.title | Demo vypršelo | Demo vypršalo | The demo has expired |
| demo.expired.body | Data ukázkové firmy byla smazána. Spusťte nové demo nebo si založte účet. | Údaje ukážkovej firmy boli vymazané. Spustite nové demo alebo si založte účet. | The sample data was deleted. Start a new demo or create an account. |
| demo.lockedField | V demu nelze měnit identitu dodavatele. | V deme nie je možné meniť identitu dodávateľa. | Supplier identity cannot be changed in the demo. |
| demo.noEmail | Demo neodesílá e-maily. | Demo neodosiela e-maily. | The demo never sends emails. |
| demo.featureDisabled | Tato funkce není v demu dostupná. | Táto funkcia nie je v deme dostupná. | This feature is not available in the demo. |
| demo.watermark | DEMO – neplatný doklad | DEMO – neplatný doklad | DEMO – invalid document |
| demo.publicNotice | Toto je ukázkový doklad z dema Billanta. Není platný, neplaťte ho. | Toto je ukážkový doklad z dema Billanta. Nie je platný, neplaťte ho. | This is a sample document from the Billanta demo. It is not valid – do not pay it. |
| errors.demo_disabled | Tato funkce není v demu dostupná. | Táto funkcia nie je v deme dostupná. | This feature is not available in the demo. |
| errors.demo_no_email | Demo neodesílá e-maily. | Demo neodosiela e-maily. | The demo never sends emails. |
| errors.demo_locked_field | V demu nelze měnit identitu dodavatele. | V deme nie je možné meniť identitu dodávateľa. | Supplier identity cannot be changed in the demo. |
| errors.demo_ai_quota | Vyčerpali jste AI požadavky pro toto demo. | Vyčerpali ste AI požiadavky pre toto demo. | You have used all AI requests for this demo. |
| errors.demo_ip_limit | Z vaší sítě bylo dnes spuštěno příliš mnoho ukázek. Zkuste to zítra. | Z vašej siete sa dnes spustilo príliš veľa ukážok. Skúste to zajtra. | Too many demos were started from your network today. Try again tomorrow. |
| errors.demo_capacity | Demo je teď přetížené. Zkuste to za chvíli. | Demo je teraz preťažené. Skúste to o chvíľu. | The demo is busy right now. Try again shortly. |
| errors.demo_row_limit | V demu jste dosáhli limitu záznamů. | V deme ste dosiahli limit záznamov. | You have reached the record limit in the demo. |
| errors.demo_expired | Demo vypršelo. | Demo vypršalo. | The demo has expired. |
| errors.demo_signed_in | Nejprve se odhlaste ze svého účtu. | Najprv sa odhláste zo svojho účtu. | Sign out of your account first. |

Add the `errors.*` keys to the same namespace that already maps backend codes such as `insufficient_credits`. Edit the files with the usual script that re-serialises the JSON.

## 8. Parallel work packages

Agree the SQL function signatures (1.3) and the error codes up front. WP2–WP5 can then start against those contracts while WP1 lands.

**WP1 – Database (contracts first)**
Owns:
- `apps/backend/drizzle/migrations/0068_demo_playground.sql`
- `drizzle/migrations/meta/_journal.json`
- `drizzle/schema.ts` (demo columns and `demoSessions`)
- `drizzle/rls-policies.sql` (`list_tenant_ids`, `public_invoice_demo`, QR / card-target NULL for demo, the `c/` and `d/` demo checks)
- `drizzle/app-role-grants.sql`

Verify with rolled-back transactions as `SET ROLE faktur_app`: changing a demo IČO fails, inserting into email_outbox fails, `list_tenant_ids` skips demo tenants.

**WP2 – Backend demo module**
Owns:
- `apps/backend/src/demo/demo.module.ts`, `demo.controller.ts`, `demo.service.ts`, `demo-seed.service.ts`, `ip-bucket.ts` (+ spec)
- `demo-cleanup.cron.ts`
- `src/demo/dataset/*` (+ `dataset.spec.ts`)
- `src/me/account-deletion.service.ts` (extract `wipeTenantData`)
- `src/app.module.ts` (import `DemoModule`; register `DemoGuard` as the second `APP_GUARD`, using WP3's class)

**WP3 – Backend guards**
Owns:
- `src/demo/demo-policy.ts` (+ spec), `src/demo/demo.guard.ts`
- `src/tenancy/tenant-context.middleware.ts`, `src/tenancy/role-access.guard.ts` (export `guardPath`)
- `src/abuse/sending-guard.ts` (+ spec), `src/email/email-outbox.service.ts` and the account-outbox enqueue
- `src/tenants/tenants.service.ts`, `src/tenants/tenants.controller.ts` (demo fields in GET me)
- `src/me/me.controller.ts`
- `src/ai/ai.service.ts`
- `src/billing/plan-access.ts` (+ spec), `src/billing/plan.guard.ts`

**WP4 – Watermarks and public surface**
Owns:
- `src/invoices/invoice-pdf.service.ts`, new `src/invoices/invoice-pdf-demo.ts` (+ spec)
- `src/public-invoices/public-invoices.service.ts` (`PublicInvoiceView.demo`)
- the backend services for the `c/` and `d/` routes
- frontend `app/[locale]/i/[token]/page.tsx`, `card-pay-button`, new `components/demo/public-demo-notice.tsx`

**WP5 – Frontend entry, session, banner, i18n**
Owns:
- `apps/frontend/auth.ts`
- `app/api/demo/start/route.ts`, `app/api/demo/end/route.ts`
- `lib/rate-limit.ts` (`DEMO_LIMITS`), `lib/api-client.ts`, `lib/tenant.ts`
- `app/[locale]/(marketing)/demo/page.tsx`, `demo/expired/page.tsx`
- `components/demo/demo-kind-picker.tsx`, `components/demo/demo-banner.tsx`, the dashboard layout
- the marketing CTA components
- the register, forgot-password, change-password and 2FA routes (demo refusal)
- settings and send-dialog disabled states
- `messages/cs.json`, `messages/sk.json`, `messages/en.json` – all keys, including the ones WP4 uses

**Order:** WP1 merges first. WP3 and WP4 depend only on the columns. WP2 needs the WP1 functions and the WP3 guard class. WP5's end-to-end test needs WP2.

**Final check:** start each of the 4 kinds, then confirm:
- no `email_outbox` rows exist for the tenant
- the PDF has the watermark and no QR
- the public link shows the notice
- the 6th AI call returns `demo_ai_quota`
- the 4th demo from the same IP returns `demo_ip_limit`
- after a forced `demo_expires_at` in the past, the cron removes the tenant, user and sessions, and the browser lands on `/demo/expired`

### Critical Files for Implementation
- C:/Programovani/OwnIdeas/Faktur/apps/backend/drizzle/schema.ts (plus the new C:/Programovani/OwnIdeas/Faktur/apps/backend/drizzle/migrations/0068_demo_playground.sql)
- C:/Programovani/OwnIdeas/Faktur/apps/backend/src/tenancy/tenant-context.middleware.ts
- C:/Programovani/OwnIdeas/Faktur/apps/backend/src/abuse/sending-guard.ts
- C:/Programovani/OwnIdeas/Faktur/apps/backend/src/invoices/invoice-pdf.service.ts
- C:/Programovani/OwnIdeas/Faktur/apps/frontend/auth.ts
