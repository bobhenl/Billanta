# apps/backend — NestJS API

NestJS 11 + Drizzle ORM on Postgres 16. Multi-tenancy is a shared schema
with **Row-Level Security**. The README has deep dives per feature (billing,
bank sync, backups, public API). This file lists the rules.

```bash
pnpm --filter @faktur/backend dev
pnpm --filter @faktur/backend typecheck
pnpm --filter @faktur/backend test          # vitest, specs next to the code (*.spec.ts)
```

Swagger UI: `/api/docs`. All routes are under `/api/v1/...`.

## Tenant isolation (the most important part)

- The runtime role `faktur_app` is `NOBYPASSRLS`, and every tenant table is
  `FORCE ROW LEVEL SECURITY` keyed on `current_setting('app.current_tenant_id')`.
- `src/tenancy/tenant-context.middleware.ts` reserves one connection per
  request, opens a transaction, sets the tenant, and exposes it as
  `req.tenantDb`. **Tenant-scoped controllers use `req.tenantDb!` and
  `req.user!.tenantId`.** They never use the pool, because a pooled
  connection has no tenant set.
- A new tenant-scoped controller **must be added to the `forRoutes(...)`
  list in `src/app.module.ts`**. If it is missing, `req.tenantDb` is
  undefined. Controllers that also accept API keys use
  `ApiKeyOrJwtTenantContextMiddleware`.
- Work that has to cross tenants (webhooks before the tenant is known,
  public invoice links, cron scans, referral rewards) goes through narrow
  `SECURITY DEFINER` SQL functions with a fixed `search_path`. Do not
  loosen a policy or connect as the owner role. Follow the existing
  functions in `drizzle/rls-policies.sql` and the migrations.
- Public / platform-level controllers (`v1/public/*`, `v1/admin/*`) use
  `DbService.db` (the pool) and touch only global tables (no `tenant_id`),
  e.g. `subscription_plans`, `partners`.

## Auth and roles

- `JwtAuthGuard` verifies the dashboard JWT. `ServiceTokenGuard` is for the
  AI service. `CombinedAuthGuard` / `ApiKeyAuthGuard` are for the public API.
- `RoleAccessGuard` is a global `APP_GUARD`. Roles: owner, admin,
  accountant, viewer, service. Per-area permissions live in
  `src/tenancy/permissions.ts`. Routes under `ADMIN_PREFIXES` in
  `role-access.guard.ts` are writable by owner/admin only. Add a new
  company-administration prefix there.
- `PlatformAdminGuard` (`src/partners/`) is for Billanta staff: an email in
  `PLATFORM_ADMIN_EMAILS` **and** a verified email (or a Google account).

## Database changes

1. Edit `drizzle/schema.ts` (the source of truth for table shape).
2. Write the migration by hand as `drizzle/migrations/NNNN_name.sql`:
   idempotent (`IF NOT EXISTS`, drop-then-add constraints), separate
   statements with `--> statement-breakpoint`, and a header comment saying
   why.
3. Add the entry to `drizzle/migrations/meta/_journal.json`. Use the next
   `idx` and a `when` **greater than every existing one**. Drizzle skips
   migrations whose `when` is older than the last applied one.
4. New tenant tables need `ENABLE` + `FORCE ROW LEVEL SECURITY` and a
   tenant policy in the migration. Table grants and append-only `REVOKE`s
   go into `drizzle/app-role-grants.sql`, which is re-run after every
   migrate.
5. Apply locally to the dev container, then re-run the grants:
   ```bash
   docker exec -i faktur-postgres-dev sh -c 'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < drizzle/migrations/NNNN_name.sql
   ```
   To check RLS, run a rolled-back transaction as `SET ROLE faktur_app`
   with `app.current_tenant_id` set.

In production, `deploy/deploy.sh` runs migrations, then
`rls-policies.sql`, then the grants.

## Conventions

- Validation: zod schemas plus `createZodDto` (nestjs-zod). The global
  `ZodValidationPipe` runs them. Put shared schemas next to the service.
- Errors: throw Nest HTTP exceptions with a **stable snake_case message
  code** (`"insufficient_credits"`, `"slug_taken"`). The frontend maps
  codes to translated text.
- Money is in CZK, as numeric strings from Postgres. Never use floats for
  sums you persist.
- Don't trust client IPs. Use `visitorIp()` from
  `src/guest-invoices/guest-limits.ts`. It honours `x-guest-ip` only when
  the request comes from a loopback or private address, i.e. the
  frontend's own server.
- Emails go through `src/email/` (Resend) and `src/abuse/` sending limits.
  Don't send real emails from tests or local experiments.
- Register a new module in the `imports` of `app.module.ts`, with a
  one-line comment if it is not obvious.
- Keep pure logic (pricing, dates, matching) in small functions with a
  `*.spec.ts` next to them.
