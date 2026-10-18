import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ApiKeyOrJwtTenantContextMiddleware } from "./api-keys/api-key-or-jwt-tenant-context.middleware";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { ApiKeysController } from "./api-keys/api-keys.controller";
import { AuthModule } from "./auth/auth.module";
import { BackupDestinationsController } from "./backup-destinations/backup-destinations.controller";
import { BackupDestinationsModule } from "./backup-destinations/backup-destinations.module";
import { BankReconciliationController } from "./bank-reconciliation/bank-reconciliation.controller";
import { BankConnectionsController } from "./bank-reconciliation/bank-connections.controller";
import { BankReconciliationModule } from "./bank-reconciliation/bank-reconciliation.module";
import { BillingModule } from "./billing/billing.module";
import { ChannelLinksController } from "./channel-links/channel-links.controller";
import { ChannelLinksModule } from "./channel-links/channel-links.module";
import { ContactsController } from "./contacts/contacts.controller";
import { AiController } from "./ai/ai.controller";
import { AiModule } from "./ai/ai.module";
import { ContactsModule } from "./contacts/contacts.module";
import { DashboardController } from "./dashboard/dashboard.controller";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email/email.module";
import { ExpensesController } from "./expenses/expenses.controller";
import { ExpensesModule } from "./expenses/expenses.module";
import { ExportsController } from "./exports/exports.controller";
import { ExportsModule } from "./exports/exports.module";
import { InvoiceTemplatesController } from "./invoice-templates/invoice-templates.controller";
import { InvoiceTemplatesModule } from "./invoice-templates/invoice-templates.module";
import { TimeTrackingController } from "./time-tracking/time-tracking.controller";
import { TimeTrackingModule } from "./time-tracking/time-tracking.module";
import { CardPaymentsModule } from "./card-payments/card-payments.module";
import { CardPaymentsSettingsController } from "./card-payments/card-payments.controller";
import { InvoicesController } from "./invoices/invoices.controller";
import { InvoicesModule } from "./invoices/invoices.module";
import { MeModule } from "./me/me.module";
import { GuestInvoicesModule } from "./guest-invoices/guest-invoices.module";
import { PublicInvoicesModule } from "./public-invoices/public-invoices.module";
import { PublicProfilesModule } from "./public-profiles/public-profiles.module";
import { RecurringInvoicesController } from "./recurring-invoices/recurring-invoices.controller";
import { RecurringInvoicesModule } from "./recurring-invoices/recurring-invoices.module";
import { TeamController } from "./team/team.controller";
import { NotificationsController } from "./notifications/notifications.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { AuditModule } from "./audit/audit.module";
import { AuditController } from "./audit/audit.controller";
import { IntegrationsController } from "./integrations/integrations.controller";
import { IntegrationsModule } from "./integrations/integrations.module";
import { TeamModule } from "./team/team.module";
import { TenantContextMiddleware } from "./tenancy/tenant-context.middleware";
import { RoleAccessGuard } from "./tenancy/role-access.guard";
import { TenantsController } from "./tenants/tenants.controller";
import { TenantsModule } from "./tenants/tenants.module";
import { PartnersModule } from "./partners/partners.module";
import { BlogModule } from "./blog/blog.module";
import { ReferralsController } from "./referrals/referrals.controller";
import { ReferralsModule } from "./referrals/referrals.module";

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
    // Tenant-resolution bootstrap for the frontend (GET /api/v1/me) — see
    // MeController's doc comment for why it's JWT-only, no
    // TenantContextMiddleware. Imported here purely for its controller;
    // nothing else depends on it.
    MeModule,
    ContactsModule,
    // Invoice pre-fill from free text (Anthropic), per-tenant AI mode/key.
    AiModule,
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
    PublicProfilesModule,
    GuestInvoicesModule,
    RecurringInvoicesModule,
    BankReconciliationModule,
    BackupDestinationsModule,
    // Team members + invitations (InvitationsController is pre-tenant, JWT-only).
    TeamModule,
    InvoiceTemplatesModule,
    TimeTrackingModule,
    // Card payments from the invoice link through the company's own Stripe.
    CardPaymentsModule,
    DashboardModule,
    ExportsModule,
    // Bell / browser / email notifications per member and event.
    NotificationsModule,
    AuditModule,
    IntegrationsModule,
    // Invite companies for credits; credits pay plans.
    ReferralsModule,
    // Public partners directory + Billanta-staff catalogue admin (no tenant context).
    PartnersModule,
    // Public /blog + staff review queue for AI drafts (no tenant context).
    BlogModule,
  ],
  // Viewers are read-only and accountants stay out of company administration.
  providers: [{ provide: APP_GUARD, useClass: RoleAccessGuard }],
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
    //   - ChannelLinksServiceController (`v1/internal/channel-links`):
    //     `verify`/`activate` resolve a tenant that isn't known yet, guarded
    //     by `ServiceTokenGuard` (AI-service scope only). The dashboard-facing
    //     ChannelLinksController IS listed below so `req.user.tenantId` and
    //     the role guard apply.
    //   - BillingController: webhooks authenticate via provider signature,
    //     not tenant JWT, and resolve their tenant from the event payload.
    //   - TenantsController's `POST /` (signup): no tenant exists yet, so
    //     it's excluded by route below even though the rest of
    //     TenantsController (`GET/PATCH /me`) is tenant-scoped — see the
    //     TODO on TenantsService.signup() for the real bootstrap path this
    //     implies.
    //   - MeController (`GET /api/v1/me`, `src/me/`): same pre-tenant-
    //     context shape as ChannelLinksController above — its entire job is
    //     telling the caller which tenant(s) it may act as, so it cannot
    //     require `X-Tenant-Id` up front. Never registered on this
    //     middleware's `forRoutes(...)` list; see that controller's doc
    //     comment and `list_tenant_memberships_for_user` in
    //     `drizzle/rls-policies.sql` for how it safely reads across the RLS
    //     boundary anyway.
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
    //   - GoogleDriveCallbackController (`src/backup-destinations/google-
    //     drive-callback.controller.ts`, `GET /v1/backup-destinations/
    //     google-drive/callback`): same pre-tenant-context shape again —
    //     Google's OAuth redirect carries no bearer token. It's a
    //     structurally SEPARATE controller class from
    //     `BackupDestinationsController` specifically so it can never
    //     accidentally end up on this list; tenant identity for that one
    //     route comes from a signed `state` JWT instead (see that
    //     controller's doc comment). `BackupDestinationsController` itself
    //     IS included below — it's an ordinary tenant-scoped CRUD
    //     controller like `ExpensesController`/`RecurringInvoicesController`.
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
        BankConnectionsController,
        BackupDestinationsController,
        TeamController,
        DashboardController,
        ExportsController,
        NotificationsController,
        IntegrationsController,
        ApiKeysController,
        ChannelLinksController,
        CardPaymentsSettingsController,
        AuditController,
        ReferralsController,
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
    // AiController too: its invoice-suggestion route is public-API.
    consumer.apply(ApiKeyOrJwtTenantContextMiddleware).forRoutes(InvoicesController, AiController, InvoiceTemplatesController, TimeTrackingController);
  }
}
