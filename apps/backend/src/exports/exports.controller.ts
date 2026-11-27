import { BadRequestException, Body, ConflictException, Controller, HttpCode, NotFoundException, Post, ServiceUnavailableException, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { eq, sql } from "drizzle-orm";
import type { Response } from "express";
import { z } from "zod";
import { refuseSealedSet } from "../vault/sealed-amounts";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { parseReportFilters, type ReportFilters } from "../dashboard/report-filters";
import { type ExportDateBy, type ExportPeriod, ExportsService, VatRateUnavailableError } from "./exports.service";
import { ReportRates } from "./uniform-rate";
import type { VatExportWarning, VatPeriod } from "./vat-returns";
import { FLAT_RATES, paidAdvances, type FlatRate } from "./annual-summary";
import { CSSZ_OSVC_YEARS, dpfdpFormFor, FormNotPublishedError, generateCsszOsvc, generateDpfdp, HEALTH_INSURERS } from "./annual-filings";
import { submitterFromTenant } from "./vat-returns";
import {
  annualFilingLinesOf,
  FILING_PERSON_PATTERNS,
  isLegalEntityName,
  normalizeTaxAdvances,
  taxReturnReportOf,
  type AnnualFilingsInputs,
  type FilingFigures,
  type TaxReturnInputs,
} from "@faktur/cz-compliance";
import { taxReturnCsv, taxReturnFileName, taxReturnPdf, type TaxReturnReport } from "./tax-return-basis";
import { tenantCountry, tenantHomeCurrencyOf } from "../tenants/home-currency";
import { spendFeature } from "../billing/plan-limits";
import type { PlanFeature } from "../billing/plans";

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

/** `?filing=` of vat-inputs: the file names of the XML routes. */
const VAT_INPUT_FILINGS = new Map<string, { country: "CZ"; kind: "dp3" | "kh1" | "shv" } | { country: "SK"; kind: "dph" | "kv" | "sv" }>([
  ["dphdp3", { country: "CZ", kind: "dp3" }],
  ["dphkh1", { country: "CZ", kind: "kh1" }],
  ["dphshv", { country: "CZ", kind: "shv" }],
  ["sk-dphv25", { country: "SK", kind: "dph" }],
  ["sk-kvdph", { country: "SK", kind: "kv" }],
  ["sk-svdph", { country: "SK", kind: "sv" }],
]);

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
  // Paid date (daňová evidence) or DUZP (účetnictví).
  basis: z.enum(["cash", "accrual"]).default("cash"),
});

const calendarDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const taxReturnQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  // CZ: the activity's paušál (80/60/40/30). SK has one 60 % paušál.
  rate: z.enum(["80", "60", "40", "30"]).default("60"),
});

const monthsSchema = z
  .union([z.array(z.coerce.number().int().min(1).max(12)), z.string().regex(/^\d{1,2}(,\d{1,2})*$/)])
  .transform((v) => (typeof v === "string" ? v.split(",").map(Number) : v))
  .refine((v) => v.length > 0 && v.every((m) => m >= 1 && m <= 12))
  .optional();

const filingsQuerySchema = annualQuerySchema.extend({
  activity: z.enum(["H", "V"]).default("H"),
  months: monthsSchema,
  taxAdvancesPaid: z.coerce.number().min(0).max(100_000_000).optional(),
  spouseCredit: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).optional(),
});

// Personal data for the files travels in the POST body only (never in a URL)
// and is not stored: it goes straight into the generated XML.
const filingPersonSchema = z.object({
  birthNumber: z.string().regex(FILING_PERSON_PATTERNS.birthNumber).optional(),
  birthDate: z.string().regex(FILING_PERSON_PATTERNS.birthDate).optional(),
  taxOffice: z.coerce.number().int().min(1).max(9999).optional(),
  taxWorkplace: z.coerce.number().int().min(1).max(9999).optional(),
  dataBox: z.string().regex(FILING_PERSON_PATTERNS.dataBox).optional(),
  variableSymbol: z.string().regex(FILING_PERSON_PATTERNS.variableSymbol).optional(),
  ossz: z.string().regex(FILING_PERSON_PATTERNS.ossz).optional(),
});
const filingBodySchema = filingsQuerySchema.merge(filingPersonSchema);

/** `?file=` of an inputs route: the browser is about to build that file, so the plan counts it. */
const taxReturnInputsSchema = taxReturnQuerySchema.extend({ file: z.enum(["csv", "pdf"]).optional() });
const filingsInputsSchema = filingsQuerySchema.extend({ file: z.enum(["dpfdp", "osvc"]).optional() });
const accountingFormatSchema = z.enum(["pohoda", "money-s3"]);

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

  @Get("invoices-csv-inputs")
  @ApiOperation({
    summary:
      "Confidential mode: the rows of invoices.csv as JSON, documents with sealed amounts carrying their envelope instead of totals, so the browser builds the CSV",
  })
  async invoicesCsvInputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    const period = parsePeriod(query);
    const { filters, dateBy } = parseInvoiceExportQuery(query);
    return this.exportsService.invoicesCsvInputs(req.tenantDb!, period, filters, dateBy);
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
    await this.spend(req, "accounting_export");
    this.send(res, body, "application/xml; charset=utf-8", `pohoda-${period.label}.xml`);
  }

  @Get("money-s3.xml")
  @ApiOperation({ summary: "Issued documents + expenses of a period as a Money S3 MoneyData XML" })
  async moneyS3(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const period = parsePeriod(query);
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    const body = await this.exportsService.moneyS3Xml(req.tenantDb!, period, tenant!);
    await this.spend(req, "accounting_export");
    this.send(res, body, "application/xml; charset=utf-8", `money-s3-${period.label}.xml`);
  }

  @Get("accounting-inputs")
  @ApiOperation({
    summary:
      "Confidential mode: what pohoda.xml / money-s3.xml are built from (?format=pohoda|money-s3 plus the period), sealed documents with their envelopes, so the browser builds the XML",
  })
  async accountingInputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    const format = accountingFormatSchema.safeParse(query.format);
    if (!format.success) throw new BadRequestException("invalid_format");
    const period = parsePeriod(query);
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    const inputs = await this.exportsService.accountingInputs(req.tenantDb!, format.data, period, tenant!);
    // The file is built in the browser, so the plan counts it here.
    await this.spend(req, "accounting_export");
    return inputs;
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
    refuseSealedSet(s.sealed);
    // The sheet follows Czech rules (DPFO, ČSSZ); the card offers its own CSV for a Slovak company.
    if (s.country !== "CZ") throw new BadRequestException("country_not_supported");
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
      ["Pozn.", "Orientační odhad bez záruky. Nenahrazuje daňové přiznání, přehledy pro ČSSZ a ZP ani daňového poradce. Údaje si před použitím ověřte."],
    ];
    const body = "﻿" + rows.map(([k, v]) => `${k};${v.includes(";") ? `"${v}"` : v}`).join("\r\n") + "\r\n";
    await this.spend(req, "income_tax_export");
    this.send(res, body, "text/csv; charset=utf-8", `rocni-prehled-${s.year}.csv`);
  }

  private async loadAnnual(req: TenantScopedRequest, query: unknown) {
    const parsed = annualQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("Invalid year summary query");
    const { year, expenses, paidSocial, paidHealth, basis } = parsed.data;
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    // Without a typed amount, the paid advances come from Settings → Měsíční zálohy (per month, as they applied then).
    const paid = paidAdvances(normalizeTaxAdvances(tenant?.taxAdvances), year, { paidSocial, paidHealth });
    const country = tenantCountry(tenant);
    try {
      const summary = await this.exportsService.annualSummary(req.tenantDb!, year, {
        vatPayer: tenant?.dicVatPayer ?? false,
        flatRate: expenses === "actual" ? null : (Number(expenses) as FlatRate),
        paidSocial: paid.paidSocial,
        paidHealth: paid.paidHealth,
        basis,
        rates: ReportRates.fromPrefs(tenant?.invoiceFormPrefs, new Date(), tenantHomeCurrencyOf(tenant)),
        homeCurrency: tenantHomeCurrencyOf(tenant),
      });
      // The dashboard card recomputes the figures from income, expenses and
      // the paid advances with the same @faktur/cz-compliance functions, under
      // the rules of the company's country.
      return { ...summary, country, paidSource: paid.source };
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }

  @Get("tax-return-basis")
  @ApiOperation({ summary: "Podklady pro daňové přiznání: the year's income, expenses by category, paušály vs. actual expenses, paušální daň and deadlines (?year=&rate=80|60|40|30)" })
  async taxReturnBasis(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    const r = await this.loadTaxReturn(req, query);
    // Calendar days, not instants: a Date would shift a day in the browser's zone.
    return { ...r, deadlines: r.deadlines.map((d) => ({ kind: d.kind, date: calendarDay(d.date) })) };
  }

  @Get("tax-return-basis.csv")
  @ApiOperation({ summary: "The same tax-return basis as a CSV sheet for the accountant" })
  async taxReturnBasisCsv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const r = await this.loadTaxReturn(req, query);
    await this.spend(req, "income_tax_export");
    this.send(res, taxReturnCsv(r), "text/csv; charset=utf-8", `${taxReturnFileName(r)}.csv`);
  }

  @Get("tax-return-basis.pdf")
  @ApiOperation({ summary: "The same tax-return basis as a PDF" })
  async taxReturnBasisPdf(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    const r = await this.loadTaxReturn(req, query);
    const pdf = await taxReturnPdf(r);
    await this.spend(req, "income_tax_export");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${taxReturnFileName(r)}.pdf"`);
    res.send(pdf);
  }

  /**
   * One year's own figures (annualSummary: paid invoices, expenses by
   * category, home currency) run through computeTaxReturnBasis, which holds
   * every rate and limit. A company is summed by DUZP (it keeps accounts),
   * a sole trader by the day paid.
   */
  private async loadTaxReturn(req: TenantScopedRequest, query: unknown): Promise<TaxReturnReport> {
    const { inputs, sealed } = await this.taxReturnInputsOf(req, query);
    refuseSealedSet(sealed);
    return taxReturnReportOf(inputs, inputs.plainIncome, inputs.counts);
  }

  @Get("tax-return-basis-inputs")
  @ApiOperation({
    summary:
      "Confidential mode: the tax-return basis apart from the sealed income (?year=&rate=, &file=csv|pdf when a file is built), sealed documents with their envelope and rate, so the browser builds the report",
  })
  async taxReturnInputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>): Promise<TaxReturnInputs> {
    const parsed = taxReturnInputsSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("invalid_tax_return_query");
    const { inputs } = await this.taxReturnInputsOf(req, parsed.data);
    if (parsed.data.file) await this.spend(req, "income_tax_export");
    return inputs;
  }

  private async taxReturnInputsOf(req: TenantScopedRequest, query: unknown): Promise<{ inputs: TaxReturnInputs; sealed: { count: number; ids: string[] } }> {
    const parsed = taxReturnQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("invalid_tax_return_query");
    await this.assertCompleteView(req);
    const { year, rate } = parsed.data;
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    const country = tenantCountry(tenant);
    const legalEntity = isLegalEntityName(tenant?.legalName);
    const basis = legalEntity ? ("accrual" as const) : ("cash" as const);
    const vatPayer = tenant?.dicVatPayer ?? false;
    const paid = paidAdvances(normalizeTaxAdvances(tenant?.taxAdvances), year, {});
    try {
      const s = await this.exportsService.annualSummary(req.tenantDb!, year, {
        vatPayer,
        flatRate: null,
        basis,
        rates: ReportRates.fromPrefs(tenant?.invoiceFormPrefs, new Date(), tenantHomeCurrencyOf(tenant)),
        homeCurrency: tenantHomeCurrencyOf(tenant),
      });
      const inputs: TaxReturnInputs = {
        country,
        year,
        vatPayer,
        legalEntity,
        flatRate: Number(rate) as FlatRate,
        paidSocial: paid.paidSocial,
        paidHealth: paid.paidHealth,
        expensesByCategory: s.byCategory,
        companyName: tenant?.legalName ?? "",
        basis,
        flatTaxRegime: tenant?.flatTaxRegime === true,
        plainIncome: s.plainIncome,
        counts: s.counts,
        sealedDocs: s.sealedDocs,
      };
      return { inputs, sealed: s.sealed };
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
  }

  @Get("annual-filings")
  @ApiOperation({ summary: "Roční podání: DPFO lines, přehled ČSSZ and the health přehled values, prefilled from the year's documents" })
  async filings(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    const parsed = filingsQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("invalid_filings_query");
    const { summary, lines } = await this.loadFilings(req, parsed.data);
    return {
      year: summary.year,
      basis: summary.basis,
      vatPayer: summary.vatPayer,
      counts: summary.counts,
      paidSource: summary.paidSource,
      ...lines,
      forms: { dpfdp: dpfdpFormFor(summary.year)?.form ?? null, cssz: (CSSZ_OSVC_YEARS as readonly number[]).includes(summary.year) },
      insurers: HEALTH_INSURERS,
    };
  }

  @Post("annual-filings/dpfdp.xml")
  @HttpCode(200)
  @ApiOperation({ summary: "DPFO return as EPO XML (DPFDP6/7) for review and filing in EPO; personal data in the body, not stored" })
  async dpfdp(@Req() req: TenantScopedRequest, @Body() body: unknown, @Res() res: Response) {
    const parsed = filingBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_filings_query");
    const { lines, tenant } = await this.loadFilings(req, parsed.data);
    const xml = this.filingFile(() => generateDpfdp(lines.dpfo, { submitter: submitterFromTenant(tenant), ...parsed.data }));
    await this.spend(req, "income_tax_export");
    this.send(res, xml, "application/xml; charset=utf-8", `dpfdp-${lines.dpfo.year}.xml`);
  }

  @Post("annual-filings/osvc.xml")
  @HttpCode(200)
  @ApiOperation({ summary: "Přehled OSVČ for ČSSZ as ePortál XML (OSVC2023–2025); personal data in the body, not stored" })
  async osvc(@Req() req: TenantScopedRequest, @Body() body: unknown, @Res() res: Response) {
    const parsed = filingBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_filings_query");
    const { lines, tenant } = await this.loadFilings(req, parsed.data);
    const xml = this.filingFile(() => generateCsszOsvc(lines.cssz, { submitter: submitterFromTenant(tenant), ...parsed.data }));
    await this.spend(req, "income_tax_export");
    this.send(res, xml, "application/xml; charset=utf-8", `prehled-osvc-cssz-${lines.cssz.year}.xml`);
  }

  private filingFile(make: () => string): string {
    try {
      return make();
    } catch (err) {
      if (err instanceof FormNotPublishedError) throw new NotFoundException("form_not_published");
      throw err;
    }
  }

  private async loadFilings(req: TenantScopedRequest, q: z.infer<typeof filingsQuerySchema>) {
    const { summary, tenant, figures } = await this.filingFigures(req, q);
    // Filings prefilled without the sealed income would understate it; the browser builds them (annual-filings-inputs).
    refuseSealedSet(summary.sealed);
    try {
      return { summary, tenant, lines: annualFilingLinesOf(figures, summary.plainIncome) };
    } catch (err) {
      if (err instanceof FormNotPublishedError) throw new NotFoundException("year_not_supported");
      throw err;
    }
  }

  private async filingFigures(req: TenantScopedRequest, q: z.infer<typeof filingsQuerySchema>) {
    await this.assertCompleteView(req);
    const summary = await this.loadAnnual(req, q);
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    if (!tenant) throw new NotFoundException("tenant_not_found");
    // DPFO, přehled ČSSZ and ZP are Czech filings; a Slovak company's amounts are in euros.
    if (summary.country !== "CZ") throw new BadRequestException("country_not_supported");
    const figures: FilingFigures = {
      year: summary.year,
      actualExpenses: summary.actualExpenses,
      flatRate: summary.flatRate,
      basis: q.basis,
      activity: q.activity,
      months: q.months,
      taxAdvancesPaid: q.taxAdvancesPaid,
      spouseCredit: q.spouseCredit,
      paidSocial: summary.social.paid ?? 0,
      paidHealth: summary.health.paid ?? 0,
    };
    return { summary, tenant, figures };
  }

  @Get("annual-filings-inputs")
  @ApiOperation({
    summary:
      "Confidential mode: what the annual filings are computed from apart from the sealed income (&file=dpfdp|osvc when a file is built), sealed documents with their envelope and rate; personal data never comes here",
  })
  async filingsInputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>): Promise<AnnualFilingsInputs> {
    const parsed = filingsInputsSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException("invalid_filings_query");
    const { summary, tenant, figures } = await this.filingFigures(req, parsed.data);
    const forms = { dpfdp: dpfdpFormFor(summary.year)?.form ?? null, cssz: (CSSZ_OSVC_YEARS as readonly number[]).includes(summary.year) };
    const { file } = parsed.data;
    if ((file === "dpfdp" && !forms.dpfdp) || (file === "osvc" && !forms.cssz)) throw new NotFoundException("form_not_published");
    if (file) await this.spend(req, "income_tax_export");
    return {
      vatPayer: summary.vatPayer,
      plainIncome: summary.plainIncome,
      counts: summary.counts,
      sealedDocs: summary.sealedDocs,
      figures,
      submitter: submitterFromTenant(tenant),
      paidSource: summary.paidSource,
      forms,
      insurers: HEALTH_INSURERS,
    };
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
  @ApiOperation({ summary: "EC sales list (souhrnné hlášení, EPO DPHSHV) – 404 when nothing to report" })
  shv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    // Monthly for goods, quarterly allowed for services only; both accepted.
    return this.vat(req, res, "shv", parseVatPeriod(query));
  }

  @Get("sk/dphv25.xml")
  @ApiOperation({ summary: "Slovak VAT return (daňové priznanie k DPH, DPHv25) for ?year=&month= or ?year=&quarter=" })
  skDph(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    return this.vatSk(req, res, "dph", parseVatPeriod(query));
  }

  @Get("sk/kvdph.xml")
  @ApiOperation({ summary: "Slovak VAT control statement (kontrolný výkaz, KVDPHv25) – due even when empty" })
  skKv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    return this.vatSk(req, res, "kv", parseVatPeriod(query));
  }

  @Get("sk/svdph.xml")
  @ApiOperation({ summary: "Slovak EC sales list (súhrnný výkaz, SVDPHv20) – 404 when nothing to report" })
  skSv(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>, @Res() res: Response) {
    return this.vatSk(req, res, "sv", parseVatPeriod(query));
  }

  @Get("vat-inputs")
  @ApiOperation({
    summary:
      "Confidential mode: what a VAT filing is built from (?filing=dphdp3|dphkh1|dphshv|sk-dphv25|sk-kvdph|sk-svdph plus the period), sealed documents with their envelope and rate, so the browser builds the XML",
  })
  async vatInputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    const filing = VAT_INPUT_FILINGS.get(query.filing ?? "");
    if (!filing) throw new BadRequestException("invalid_filing");
    await this.assertCompleteView(req);
    const period = parseVatPeriod(query);
    const tenant = filing.country === "SK" ? await this.skTenant(req) : await this.czTenant(req, filing.kind, period.vat);
    let inputs;
    try {
      inputs = await this.exportsService.vatInputs(req.tenantDb!, filing, period, period.vat, tenant);
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    // The file is built in the browser, so the plan counts it here.
    await this.spend(req, "vat_filings");
    return inputs;
  }

  /** The company, if it may file Slovak VAT forms: they identify the payer by the IČ DPH (SK + 10 digits). */
  private async skTenant(req: TenantScopedRequest) {
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    if (!tenant?.dic || !/^SK\d{10}$/i.test(tenant.dic.replace(/\s/g, ""))) {
      throw new BadRequestException("sk_vat_id_required");
    }
    return tenant;
  }

  /** The company, if it may file this Czech VAT form for this period. */
  private async czTenant(req: TenantScopedRequest, kind: "dp3" | "kh1" | "shv", vat: VatPeriod) {
    const [tenant] = await req.tenantDb!.select().from(schema.tenants).where(eq(schema.tenants.id, req.user!.tenantId));
    if (!tenant?.dic) throw new BadRequestException("Company has no DIČ – VAT filings need it");
    if (tenant.vatStatus === "identified") {
      // Only payers file kontrolní hlášení (§ 101c ZDPH); an identified
      // person's tax period is always the calendar month (§ 99a needs a payer).
      if (kind === "kh1") throw new BadRequestException("identified_no_control_statement");
      if (kind === "dp3" && !("month" in vat)) throw new BadRequestException("identified_monthly_only");
    }
    return tenant;
  }

  private async vatSk(
    req: TenantScopedRequest,
    res: Response,
    kind: "dph" | "kv" | "sv",
    period: ExportPeriod & { vat: VatPeriod; label: string },
  ) {
    await this.assertCompleteView(req);
    const tenant = await this.skTenant(req);
    let body: string | null;
    try {
      body = await this.exportsService.vatReturnSk(req.tenantDb!, kind, period, period.vat, tenant);
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (body == null) throw new NotFoundException("No EU supplies to report in this period");
    const name = { dph: "dphv25", kv: "kvdph", sv: "svdph" }[kind];
    await this.spend(req, "vat_filings");
    this.send(res, body, "application/xml; charset=utf-8", `${name}-${period.label}.xml`);
  }

  private async vat(
    req: TenantScopedRequest,
    res: Response,
    kind: "dp3" | "kh1" | "shv",
    period: ExportPeriod & { vat: VatPeriod; label: string },
  ) {
    await this.assertCompleteView(req);
    const tenant = await this.czTenant(req, kind, period.vat);
    let body: string | null;
    let warnings: VatExportWarning[];
    try {
      ({ body, warnings } = await this.exportsService.vatReturn(req.tenantDb!, kind, period, period.vat, tenant));
    } catch (err) {
      if (err instanceof VatRateUnavailableError) throw new ServiceUnavailableException(err.message);
      throw err;
    }
    if (body == null) {
      throw new NotFoundException(kind === "dp3" ? "No VAT due for an identified person in this month" : "No EU supplies to report in this period");
    }
    const name = { dp3: "dphdp3", kh1: "dphkh1", shv: "dphshv" }[kind];
    // The file still downloads; the export box reads this header and names
    // the documents to fix (e.g. a reverse-charge invoice without kód
    // předmětu plnění, which EPO would reject). URI-encoded JSON, since
    // document numbers may hold non-ASCII characters.
    await this.spend(req, "vat_filings");
    if (warnings.length) res.setHeader("X-Vat-Warnings", encodeURIComponent(JSON.stringify(warnings)));
    this.send(res, body, "application/xml; charset=utf-8", `${name}-${period.label}.xml`);
  }

  /**
   * The plan check for a file download, as late as possible: the file is
   * built first, so a 400/404 (no DIČ, nothing to report) costs no taste
   * use. The on-screen figures (the JSON routes) stay open on every plan.
   */
  /**
   * A filing is the whole company's. Built from what a limited member sees
   * (own records only, or with something locked away from them) it would
   * come out short without saying so, so it is refused instead: 409
   * filing_needs_full_view. The answer is one yes or no for the company and
   * tells nothing about which record or how much (app_view_complete).
   */
  private async assertCompleteView(req: TenantScopedRequest) {
    const [row] = await req.tenantDb!.execute<{ complete: boolean }>(sql`SELECT app_view_complete() AS complete`);
    if (!row?.complete) throw new ConflictException("filing_needs_full_view");
  }

  private async spend(req: TenantScopedRequest, feature: PlanFeature) {
    await spendFeature(req.tenantDb!, req.user!.tenantId, feature);
  }

  private send(res: Response, body: string, type: string, filename: string) {
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(body);
  }
}
