import { BadRequestException, Controller, NotFoundException, ServiceUnavailableException, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { parseReportFilters, type ReportFilters } from "../dashboard/report-filters";
import { type ExportDateBy, type ExportPeriod, ExportsService, VatRateUnavailableError } from "./exports.service";
import { ReportRates } from "./uniform-rate";
import type { VatPeriod } from "./vat-returns";
import { FLAT_RATES, paidAdvances, type FlatRate } from "./annual-summary";
import { normalizeTaxAdvances } from "@faktur/cz-compliance";

const vatPeriodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12).optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
});

/** `?year=&month=` or `?year=&quarter=` — the periods VAT filings use. */
function parseVatPeriod(query: Record<string, string>): ExportPeriod & { vat: VatPeriod; label: string } {
  const parsed = vatPeriodSchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException("Invalid VAT period");
  const { year, month, quarter } = parsed.data;
  if (quarter && !month) {
    return {
      from: new Date(year, (quarter - 1) * 3, 1),
      to: new Date(year, quarter * 3, 1),
      vat: { year, quarter },
      label: `${year}-Q${quarter}`,
    };
  }
  if (month && !quarter) {
    return {
      from: new Date(year, month - 1, 1),
      to: new Date(year, month, 1),
      vat: { year, month },
      label: `${year}-${String(month).padStart(2, "0")}`,
    };
  }
  throw new BadRequestException("Pass either ?month= or ?quarter=");
}

const periodQuerySchema = z.object({
  // YYYY-MM (one month), or from/to as YYYY-MM-DD (to inclusive).
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(localDay).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(localDay).optional(),
});

/** A YYYY-MM-DD as local midnight, like the `month` branch (`new Date("…")` would be UTC midnight). */
function localDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function parsePeriod(query: Record<string, string>): ExportPeriod & { label: string } {
  const parsed = periodQuerySchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException("Invalid period");
  const { month, from, to } = parsed.data;
  if (from && to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1);
    if (end <= from) throw new BadRequestException("'to' must not be before 'from'");
    return { from, to: end, label: `${query.from}_${query.to}` };
  }
  const now = new Date();
  const [y, m] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
  return { from: new Date(y!, m! - 1, 1), to: new Date(y!, m!, 1), label: `${y}-${String(m).padStart(2, "0")}` };
}

/** Filters and date basis for the invoice list; anything malformed is a 400, never ignored. */
export function parseInvoiceExportQuery(query: Record<string, unknown>): { filters: ReportFilters; dateBy: ExportDateBy } {
  const dateBy = query.dateBy ?? "issue";
  if (dateBy !== "issue" && dateBy !== "supply") throw new BadRequestException("Invalid dateBy");
  try {
    return { filters: parseReportFilters(query), dateBy };
  } catch {
    throw new BadRequestException("Invalid export filters");
  }
}

const annualQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  // Paušální výdaje (80/60/40/30) or "actual".
  expenses: z.enum(["actual", ...(Object.keys(FLAT_RATES) as [string, ...string[]])]).default("60"),
  paidSocial: z.coerce.number().min(0).max(10_000_000).optional(),
  paidHealth: z.coerce.number().min(0).max(10_000_000).optional(),
});

/** Exports for the accountant. Any member (incl. the accountant role) may download. */
@ApiTags("exports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Get("invoices.csv")
  @ApiOperation({
    summary:
      "Issued documents of a period as CSV for the accountant (?month=YYYY-MM or ?from=&to=; dateBy=issue|supply; optional report filters currency, language, contactId, documentType, status)",
  })
  async invoicesCsv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const period = parsePeriod(query);
    const { filters, dateBy } = parseInvoiceExportQuery(query);
    const body = await this.exportsService.invoicesCsv(req.tenantDb!, period, filters, dateBy);
    this.send(res, body, "text/csv; charset=utf-8", `faktury-${period.label}.csv`);
  }

  @Get("expenses.csv")
  @ApiOperation({ summary: "Expenses of a period as CSV" })
  async expensesCsv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const period = parsePeriod(query);
    const body = await this.exportsService.expensesCsv(req.tenantDb!, period);
    this.send(res, body, "text/csv; charset=utf-8", `naklady-${period.label}.csv`);
  }

  @Get("pohoda.xml")
  @ApiOperation({ summary: "Issued documents + expenses of a period as a Pohoda XML dataPack" })
  async pohoda(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const period = parsePeriod(query);
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    const body = await this.exportsService.pohodaXml(req.tenantDb!, period, tenant!);
    this.send(res, body, "application/xml; charset=utf-8", `pohoda-${period.label}.xml`);
  }

  @Get("money-s3.xml")
  @ApiOperation({ summary: "Issued documents + expenses of a period as a Money S3 MoneyData XML" })
  async moneyS3(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const period = parsePeriod(query);
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    const body = await this.exportsService.moneyS3Xml(req.tenantDb!, period, tenant!);
    this.send(res, body, "application/xml; charset=utf-8", `money-s3-${period.label}.xml`);
  }

  @Get("annual-summary")
  @ApiOperation({ summary: "OSVČ year estimate: cash-basis income/expenses, DPFO, social & health insurance and next year's advances (?year=&expenses=60|actual)" })
  async annual(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    return this.loadAnnual(req, query);
  }

  @Get("annual-summary.csv")
  @ApiOperation({ summary: "The same year estimate as a CSV sheet" })
  async annualCsv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const s = await this.loadAnnual(req, query);
    const n = (v: number | null) => (v == null ? "" : v.toFixed(2).replace(".", ","));
    const rows: [string, string][] = [
      ["Rok", String(s.year)],
      ["Plátce DPH (částky bez DPH)", s.vatPayer ? "ano" : "ne"],
      ["Příjmy (uhrazené doklady)", n(s.income)],
      ["Skutečné výdaje", n(s.actualExpenses)],
      ["Paušální výdaje", s.flatRate ? `${s.flatRate} % = ${n(s.flatExpenses)}` : "nepoužity"],
      ["Uplatněné výdaje", n(s.expenses)],
      ["Zisk", n(s.profit)],
      ["Základ daně (zaokr. na 100)", n(s.tax.base)],
      ["Daň před slevou", n(s.tax.beforeCredit)],
      ["Sleva na poplatníka", n(s.tax.credit)],
      ["Daň z příjmů (DPFO)", n(s.tax.total)],
      ["Vyměřovací základ – sociální", n(s.social.base)],
      ["Sociální pojištění za rok", n(s.social.total)],
      ["Zaplacené zálohy – sociální", n(s.social.paid)],
      ["Doplatek / přeplatek – sociální", n(s.social.balance)],
      ["Nová měsíční záloha – sociální", n(s.social.nextAdvance)],
      ["Vyměřovací základ – zdravotní", n(s.health.base)],
      ["Zdravotní pojištění za rok", n(s.health.total)],
      ["Zaplacené zálohy – zdravotní", n(s.health.paid)],
      ["Doplatek / přeplatek – zdravotní", n(s.health.balance)],
      ["Nová měsíční záloha – zdravotní", n(s.health.nextAdvance)],
      ["Celkem daň + pojištění", n(s.totalBurden)],
      ...(s.paidSource.social === "settings" || s.paidSource.health === "settings"
        ? ([["Zaplacené zálohy", "podle nastavení měsíčních záloh (výše platná v jednotlivých měsících)"]] as [string, string][])
        : []),
      ["Pozn.", "Orientační odhad, nenahrazuje daňové přiznání ani přehledy pro ČSSZ a ZP."],
    ];
    const body = "﻿" + rows.map(([k, v]) => `${k};${v.includes(";") ? `"${v}"` : v}`).join("\r\n") + "\r\n";
    this.send(res, body, "text/csv; charset=utf-8", `rocni-prehled-${s.year}.csv`);
  }

  private async loadAnnual(req: TenantScopedRequest, query: Record<string, string>) {
    const parsed = annualQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid year summary query");
    const { year, expenses, paidSocial, paidHealth } = parsed.data;
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    // Without a typed amount, the paid advances come from Settings → Měsíční zálohy (per month, as they applied then).
    const paid = paidAdvances(normalizeTaxAdvances(tenant?.taxAdvances), year, { paidSocial, paidHealth });
    try {
      const summary = await this.exportsService.annualSummary(req.tenantDb!, year, {
        vatPayer: tenant?.dicVatPayer ?? false,
        flatRate: expenses === "actual" ? null : (Number(expenses) as FlatRate),
        paidSocial: paid.paidSocial,
        paidHealth: paid.paidHealth,
        rates: ReportRates.fromPrefs(tenant?.invoiceFormPrefs),
      });
      return { ...summary, paidSource: paid.source };
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }

  @Get("dphdp3.xml")
  @ApiOperation({ summary: "VAT return (přiznání k DPH, EPO DPHDP3) for ?year=&month= or ?year=&quarter=" })
  dp3(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    return this.vat(req, res, "dp3", parseVatPeriod(query));
  }

  @Get("dphkh1.xml")
  @ApiOperation({ summary: "VAT control statement (kontrolní hlášení, EPO DPHKH1)" })
  kh1(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    return this.vat(req, res, "kh1", parseVatPeriod(query));
  }

  @Get("dphshv.xml")
  @ApiOperation({ summary: "EC sales list (souhrnné hlášení, EPO DPHSHV) — 404 when nothing to report" })
  shv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    // Monthly for goods, quarterly allowed for services only; both accepted.
    return this.vat(req, res, "shv", parseVatPeriod(query));
  }

  private async vat(
    req: TenantScopedRequest,
    res: Response,
    kind: "dp3" | "kh1" | "shv",
    period: ExportPeriod & { vat: VatPeriod; label: string },
  ) {
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    if (!tenant?.dic) throw new BadRequestException("Company has no DIČ — VAT filings need it");
    let body: string | null;
    try {
      body = await this.exportsService.vatReturn(req.tenantDb!, kind, period, period.vat, tenant);
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (body == null) throw new NotFoundException("No EU supplies to report in this period");
    const name = { dp3: "dphdp3", kh1: "dphkh1", shv: "dphshv" }[kind];
    this.send(res, body, "application/xml; charset=utf-8", `${name}-${period.label}.xml`);
  }

  private send(res: Response, body: string, type: string, filename: string) {
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
  }
}
