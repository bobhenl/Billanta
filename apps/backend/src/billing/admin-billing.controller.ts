import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { sql } from "drizzle-orm";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DbService } from "../db/db.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { planPaidMessage } from "./billing-messages";
import { isPaidPlan } from "./plans";
import { TenantBillingRepository } from "./tenant-billing.repository";

/**
 * Proformas across all companies. Companies are tenants, so both the list
 * and the "paid" switch go through SECURITY DEFINER functions (migration
 * 0051) rather than reading `platform_proformas` from the pool.
 */
@Injectable()
export class AdminBillingService {
  private readonly logger = new Logger(AdminBillingService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly notifications: NotificationsService,
    private readonly tenantBilling: TenantBillingRepository,
  ) {}

  list(status: string | undefined) {
    const s = status === "pending" || status === "paid" || status === "canceled" ? status : null;
    return this.dbService.db.execute(sql`SELECT * FROM list_platform_proformas(${s})`);
  }

  async markPaid(id: string, adminEmail: string) {
    const rows = await this.dbService.db.execute<{ result: string; tenant_id: string | null; plan: string | null; prepaid_until: string | null }>(
      sql`SELECT * FROM mark_platform_proforma_paid(${id}::uuid, ${adminEmail})`,
    );
    const r = rows[0];
    if (!r || r.result === "not_found") throw new NotFoundException("proforma_not_found");
    if (r.result !== "paid" || !r.tenant_id || !r.plan || !r.prepaid_until) throw new BadRequestException("proforma_not_pending");
    const tenantId = r.tenant_id;
    const until = String(r.prepaid_until).slice(0, 10);
    this.logger.log(`proforma ${id} marked paid by a platform admin; tenant ${tenantId} prepaid ${r.plan} until ${until}`);

    let locale: string | null = null;
    const proforma = await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const [t] = await tx<{ default_locale: string | null }[]>`SELECT default_locale FROM tenants WHERE id = ${tenantId}`;
      locale = t?.default_locale ?? null;
      const [p] = await tx<{ amount_minor: number; currency: string; months: number }[]>`
        SELECT amount_minor, currency, months FROM platform_proformas WHERE id = ${id}`;
      return p;
    });
    // A bank transfer counts towards the inviter's reward like a card payment:
    // a month waits for the next one, a prepaid year for the refund window.
    if (proforma && (proforma.currency === "CZK" || proforma.currency === "EUR")) {
      await this.tenantBilling.recordReferralPayment(tenantId, {
        amountMinor: Number(proforma.amount_minor),
        currency: proforma.currency,
        longPeriod: Number(proforma.months) > 1,
      });
    }
    if (isPaidPlan(r.plan)) {
      await this.notifications.deliverBilling(tenantId, planPaidMessage(locale, r.plan, until)).catch((err: Error) => {
        this.logger.warn(`plan-paid notice for tenant ${tenantId} failed: ${err.message}`);
      });
    }
    return { id, tenantId, plan: r.plan, prepaidUntil: until };
  }
}

/** Billanta staff confirm bank transfers here (`PLATFORM_ADMIN_EMAILS`). */
@ApiTags("admin-billing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/billing/proformas")
export class AdminBillingController {
  constructor(private readonly adminBilling: AdminBillingService) {}

  @Get()
  @ApiOperation({ summary: "Proformas of all companies, newest first (optional ?status=pending|paid|canceled)" })
  list(@Query("status") status?: string) {
    return this.adminBilling.list(status);
  }

  @Post(":id/mark-paid")
  @ApiOperation({ summary: "Record the bank transfer as received and start (or extend) the prepaid plan" })
  markPaid(@Param("id", ParseUUIDPipe) id: string, @Req() req: TenantScopedRequest) {
    return this.adminBilling.markPaid(id, req.user!.email!);
  }
}
