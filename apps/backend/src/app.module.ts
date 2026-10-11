import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ApiKeyOrJwtTenantContextMiddleware } from "./api-keys/api-key-or-jwt-tenant-context.middleware";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { AuthModule } from "./auth/auth.module";
import { BankReconciliationController } from "./bank-reconciliation/bank-reconciliation.controller";
import { BankReconciliationModule } from "./bank-reconciliation/bank-reconciliation.module";
import { BillingModule } from "./billing/billing.module";
import { ChannelLinksModule } from "./channel-links/channel-links.module";
import { ContactsController } from "./contacts/contacts.controller";
import { ContactsModule } from "./contacts/contacts.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { ExpensesController } from "./expenses/expenses.controller";
import { ExpensesModule } from "./expenses/expenses.module";
import { InvoicesController } from "./invoices/invoices.controller";
import { InvoicesModule } from "./invoices/invoices.module";
import { PublicInvoicesModule } from "./public-invoices/public-invoices.module";
import { RecurringInvoicesController } from "./recurring-invoices/recurring-invoices.controller";
import { RecurringInvoicesModule } from "./recurring-invoices/recurring-invoices.module";
import { TenantContextMiddleware } from "./tenancy/tenant-context.middleware";
import { TenantsController } from "./tenants/tenants.controller";
import { TenantsModule } from "./tenants/tenants.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Registered once, globally, here — required for any `@Cron` handler
    // anywhere in the app to actually fire (Nest's `SchedulerRegistry` is
    // only wired up once `ScheduleModule.forRoot()` is imported somewhere).
    // `RecurringInvoiceGenerationService`'s daily job
    // (src/recurring-invoices/recurring-invoice-generation.service.ts) is
    // the first consumer; if another module later needs its own `@Cron`,
    // it should NOT re-register `ScheduleModule.forRoot()` again — importing
    // it more than once in the same app is unnecessary (it's effectively a
    // singleton registration) and only needs to happen here.
    ScheduleModule.forRoot(),
    DbModule,
    // Global JwtModule registration (JWT_SECRET-based HS256 verification)
    // consumed by JwtAuthGuard AND TenantContextMiddleware — see
    // auth.module.ts's doc comment for why one import here is enough.
    AuthModule,
    // Public-API keys (tenant-managed `sk_live_...` credentials) — see
    // ApiKeysModule's own doc comment. Imported at the root both for its
    // controller (`ApiKeysController`, dashboard-only key management) and
    // so `ApiKeyOrJwtTenantContextMiddleware` below can resolve
    // `ApiKeysService` via this module's exports.
    ApiKeysModule,
    TenantsModule,
    ContactsModule,
    // EmailModule: invoice-emailing / overdue-payment-reminder feature —
    // InvoicesModule already imports it directly for DI (EmailService is
    // needed by InvoicesService.sendInvoice and InvoiceRemindersCron), but
    // it's also registered here at the root so any other module that later
    // wants to send transactional email (e.g. a tenant-signup welcome
    // email) can import it without re-discovering this dependency.
    EmailModule,
    InvoicesModule,
    ExpensesModule,
    ChannelLinksModule,
    BillingModule,
    PublicInvoicesModule,
    RecurringInvoicesModule,
    BankReconciliationModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Tenant context (§4) must run on every tenant-scoped route so
    // `req.tenantDb` (SET LOCAL app.current_tenant_id already applied) is
    // in place before any repository call. Applied explicitly per
    // controller — rather than `forRoutes('*')` + `.exclude(...)` — because
    // matching exclude patterns against the post-global-prefix path is
    // fragile across Nest versions; listing controllers directly is not.
    //
    // Deliberately EXCLUDED:
    //   - ChannelLinksController: `verify`'s whole point is resolving a
    //     tenant that isn't known yet, and `channel_links` itself carries no
    //     RLS policy at all (see the "Deliberately EXCLUDED" section of
    //     `drizzle/rls-policies.sql` and the comment on
    //     `ChannelLinksService.verify`) — so there is no RLS-scoped
    //     `req.tenantDb` connection for this controller to use in the first
    //     place, for either of its routes.
    //   - BillingController: webhooks authenticate via provider signature,
    //     not tenant JWT, and resolve their tenant from the event payload.
    //   - TenantsController's `POST /` (signup): no tenant exists yet, so
    //     it's excluded by route below even though the rest of
    //     TenantsController (`GET/PATCH /me`) is tenant-scoped — see the
    //     TODO on TenantsService.signup() for the real bootstrap path this
    //     implies.
    //   - PublicInvoicesController (client portal, `GET
    //     /api/v1/public/invoices/:token`): same shape as ChannelLinksController
    //     above — a client opening an emailed invoice link has no session, no
    //     JWT, and no tenant to resolve. It's excluded here structurally (its
    //     own module, never registered on this middleware's `forRoutes(...)`
    //     list) rather than via an `.exclude(...)` entry, and it's not even
    //     decorated with `@UseGuards(JwtAuthGuard)` — see that controller's
    //     doc comment. Every read it does goes through a narrow SECURITY
    //     DEFINER SQL function keyed on the invoice's public_token, never
    //     `req.tenantDb`.
    //
    // RecurringInvoicesController IS included below — it's an ordinary
    // tenant-scoped CRUD controller (templates a tenant manages), unlike
    // `RecurringInvoiceGenerationService`'s `@Cron` job, which runs outside
    // any HTTP request and opens its own `sql.begin()` transaction per
    // tenant directly (see that service's doc comment) — it has no
    // controller/route to attach this middleware to in the first place.
    //
    // BankReconciliationController is likewise an ordinary tenant-scoped
    // controller (CSV import + auto-match + manual match/ignore, all
    // against `req.tenantDb`) — included below for the same reason as
    // ExpensesController/RecurringInvoicesController.
    //
    // InvoicesController is NOT in this list — see immediately below.
    consumer
      .apply(TenantContextMiddleware)
      .exclude({ path: "v1/tenants", method: RequestMethod.POST })
      .forRoutes(
        TenantsController,
        ContactsController,
        ExpensesController,
        RecurringInvoicesController,
        BankReconciliationController,
      );

    // InvoicesController: same tenant-context requirement as every
    // controller above, but two of its routes (`GET /`, `POST /drafts`) are
    // the public API's representative endpoints and also accept a
    // `sk_live_...` API key (`CombinedAuthGuard` — see
    // apps/backend/src/auth/combined-auth.guard.ts, wired onto those two
    // routes in invoices.controller.ts). `ApiKeyOrJwtTenantContextMiddleware`
    // wraps `TenantContextMiddleware` UNCHANGED — delegating to it verbatim
    // for any non-API-key bearer token — and adds exactly one extra branch:
    // resolve tenant context directly from an API key's own `tenant_id`
    // column when the bearer token has that shape. See that class's doc
    // comment for why this had to be a middleware (not a guard): guards run
    // AFTER middleware, and `TenantContextMiddleware` unconditionally
    // verifies the bearer token as a JWT with no bypass hook for a
    // differently-shaped credential, so a guard alone can never be reached
    // for an API-key request on a route this middleware also covers.
    consumer.apply(ApiKeyOrJwtTenantContextMiddleware).forRoutes(InvoicesController);
  }
}
