import { BadRequestException, Body, Controller, Get, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { effectivePermissions } from "../tenancy/permissions";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { DASHBOARD_WIDGETS, DashboardService } from "./dashboard.service";
import { parseReportFilters, type ReportFilters } from "./report-filters";
import { upcomingTaxEvents } from "./tax-calendar";
import { getCnbRates } from "../exports/cnb-rates";

const dashboardConfigSchema = z
  .object({
    cards: z.array(z.enum(DASHBOARD_WIDGETS)).max(DASHBOARD_WIDGETS.length),
    tiles: z.array(z.string().max(40)).max(24).nullable(),
    showChart: z.boolean(),
    showRecent: z.boolean(),
    showTopCustomers: z.boolean(),
    showDueSoon: z.boolean(),
    showTaxDeadlines: z.boolean(),
    taxDeadlines: z.array(z.string().max(32)).max(16).nullable(),
    showFxRates: z.boolean(),
    fxCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(8).nullable(),
    taxAmounts: z.record(z.string().max(32), z.number().nonnegative().max(10_000_000)).nullable(),
  })
  .partial();

class DashboardConfigDto extends createZodDto(dashboardConfigSchema) {}

/** Dashboard home: KPIs, chart data and each member's own layout. */
@ApiTags("dashboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("summary")
  @ApiOperation({ summary: "KPIs, 12-month revenue/expense chart, recent, overdue and soon-due documents, top customers, attention counters" })
  async summary(@Req() req: TenantScopedRequest) {
    const result = await this.dashboardService.summary(req.tenantDb!);
    // `v1/dashboard` is outside the per-area permissions, so the document
    // lists follow the member's invoice access here. The public link token
    // never goes out: it opens the full invoice without any membership.
    const canSeeInvoices = effectivePermissions(req.user!.role, req.user!.permissions).invoices !== "none";
    const rows = (list: typeof result.recent) =>
      canSeeInvoices ? list.map(({ publicToken: _publicToken, ...row }) => row) : [];
    return { ...result, recent: rows(result.recent), overdue: rows(result.overdue), dueSoon: rows(result.dueSoon) };
  }

  @Get("stats")
  @ApiOperation({
    summary:
      "Period report: totals for from..to (YYYY-MM-DD, inclusive) vs the same-length period before, a revenue/expense series, top customers and pie shares. Optional filters: currency, language, contactId, documentType (invoice|proforma|credit_note), status (paid|unpaid|overdue|cancelled)",
  })
  stats(@Req() req: TenantScopedRequest, @Query() query: Record<string, unknown>) {
    const from = typeof query.from === "string" ? query.from : undefined;
    const to = typeof query.to === "string" ? query.to : undefined;
    let filters: ReportFilters;
    try {
      filters = parseReportFilters(query);
    } catch {
      throw new BadRequestException("Invalid report filters");
    }
    const day = (value: string | undefined) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    };
    const now = new Date();
    const end = day(to) ?? now;
    let start = day(from) ?? new Date(now.getFullYear(), now.getMonth() - 11, 1);
    if (start > end) throw new BadRequestException("from must not be after to");
    // At most five years in one report.
    const earliest = new Date(end.getFullYear() - 5, end.getMonth(), end.getDate());
    if (start < earliest) start = earliest;
    return this.dashboardService.stats(req.tenantDb!, start, end, filters);
  }

  @Get("config")
  @ApiOperation({ summary: "The signed-in member's dashboard layout (cards, quick actions, sections)" })
  getConfig(@Req() req: TenantScopedRequest) {
    return this.dashboardService.getConfig(req.tenantDb!, req.user!.tenantId, req.user!.id);
  }

  @Get("tax-calendar")
  @ApiOperation({ summary: "Upcoming rows of the official Czech tax calendar (Finanční správa), cached daily; events = null when the source is unreachable" })
  async taxCalendar(@Query("days") days?: string) {
    const span = Math.min(Math.max(Number(days) || 45, 1), 366);
    return { source: "financnisprava.gov.cz", events: await upcomingTaxEvents(span) };
  }

  @Get("fx-rates")
  @ApiOperation({ summary: "Today's ČNB rates (CZK per unit) for the given currencies, plus the rate a week ago for the trend" })
  async fxRates(@Query("currencies") currencies?: string) {
    const list = (currencies ?? "EUR,USD,GBP")
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => /^[A-Z]{3}$/.test(c) && c !== "CZK")
      .slice(0, 8);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const [today, previous] = await Promise.all([getCnbRates(list), getCnbRates(list, weekAgo)]);
    return {
      source: "cnb.cz",
      rates: list.map((code) => ({ code, rate: today[code] ?? null, weekAgo: previous[code] ?? null })),
    };
  }

  @Put("config")
  @ApiOperation({ summary: "Save (merge) the signed-in member's dashboard layout" })
  saveConfig(@Req() req: TenantScopedRequest, @Body() dto: DashboardConfigDto) {
    return this.dashboardService.saveConfig(req.tenantDb!, req.user!.tenantId, req.user!.id, dto);
  }
}
