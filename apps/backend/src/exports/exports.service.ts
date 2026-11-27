import { type TemplateVar, templateVarsOf } from "../tenants/template-vars";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { expenseVatParts } from "../expenses/expense-vat";
import { matchesFilters, type ReportFilters } from "../dashboard/report-filters";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeVatBreakdown, type InvoiceVatBreakdown, round2 } from "../invoices/invoice-total.util";
import { type AccountingBasis, computeAnnualSummary, type FlatRate } from "./annual-summary";
import { getHomeRate } from "./home-rates";
import {
  annualIncomeOf,
  buildCzVatFiling,
  type SealedIncomeDoc,
  moneyS3Xml,
  pohodaXml,
  type AccountingFileInput,
  type AccountingFormat,
  type SealedAccountingInputs,
  buildSkVatFiling,
  csvSheet,
  homeCurrencyOf,
  invoicesCsvBody,
  vatPartsOf,
  type CzVatFilingKind,
  type FilingIssuedDoc,
  type HomeCurrency,
  type SealedCsvInputs,
  type SealedVatInputs,
  type SkVatFilingKind,
} from "@faktur/cz-compliance";
import { ReportRates } from "./uniform-rate";
import { classifyIssued, submitterFromTenant, type VatExportWarning, type VatPeriod, type VatReceivedDoc } from "./vat-returns";
import { skSubmitterFromTenant } from "./vat-returns-sk";
import { tenantHomeCurrencyOf } from "../tenants/home-currency";
import { redactSealedInvoice, redactSealedItem } from "../vault/sealed";
import { redactSealedContact } from "../vault/sealed-contacts";
import { amountsSealed, refuseSealedRows, splitSealed } from "../vault/sealed-amounts";

type Db = PostgresJsDatabase<typeof schema>;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;

export interface ExportPeriod {
  from: Date;
  /** Exclusive. */
  to: Date;
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

function csDate(d: Date | null | undefined): string {
  if (!d) return "";
  const x = new Date(d);
  return `${x.getDate()}.${x.getMonth() + 1}.${x.getFullYear()}`;
}

const csv = csvSheet;

// The XML builders are shared with the browser (sealed amounts): cz-compliance.
export { moneyTotals, moneyVatSummary } from "@faktur/cz-compliance";

/** Which date puts a document into the export period. */
export type ExportDateBy = "issue" | "supply";

// The CSV builder is shared with the browser (sealed amounts): cz-compliance.
export { invoicesCsvBody, type CsvInvoiceRow } from "@faktur/cz-compliance";

/**
 * Accountant exports for a period (by issue date): CSV for spreadsheets and
 * a Pohoda XML dataPack (issued invoices, credit notes, proformas and
 * received expenses) that Pohoda imports via Soubor → Datová komunikace →
 * XML import. Only issued documents (with a number) are exported.
 */
@Injectable()
export class ExportsService {
  /**
   * `sealed: "envelope"` keeps documents with sealed amounts (null totals,
   * the envelope instead) for the browser to build the file; by default they
   * are refused, since they would export as 0.
   */
  private async loadInvoices(
    db: Db,
    period: ExportPeriod,
    filters: ReportFilters = {},
    dateBy: ExportDateBy = "issue",
    sealed: "refuse" | "envelope" = "refuse",
  ) {
    // By DUZP (falling back to the issue date) the list matches the Reports page; by issue date it is the classic book.
    const supply = sql`coalesce(${schema.invoices.taxableSupplyDate}, ${schema.invoices.issueDate})`;
    const inPeriod =
      dateBy === "supply"
        ? and(sql`${supply} >= ${period.from.toISOString()}`, sql`${supply} < ${period.to.toISOString()}`)
        : and(gte(schema.invoices.issueDate, period.from), lt(schema.invoices.issueDate, period.to));
    const rows = await db
      .select({ invoice: schema.invoices, contact: schema.contacts })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(
        and(
          isNotNull(schema.invoices.invoiceNumber),
          inPeriod,
          filters.contactId ? eq(schema.invoices.contactId, filters.contactId) : undefined,
          filters.currency ? eq(schema.invoices.currency, filters.currency) : undefined,
        ),
      )
      .orderBy(asc(schema.invoices.issueDate), asc(schema.invoices.invoiceNumber));

    // The rest of the filters (status "overdue" needs today) run in memory, on the same rule as the report.
    const today = new Date();
    const kept = rows.filter((r) => r.invoice.documentType !== "quote" && matchesFilters(r.invoice, filters, today));
    // Sealed amounts would export as 0: the accountant's file is refused rather than quietly wrong.
    if (sealed === "refuse") refuseSealedRows(kept.map((r) => r.invoice));
    const ids = kept.map((r) => r.invoice.id);
    const items = ids.length
      ? await db
          .select()
          .from(schema.invoiceLineItems)
          .where(inArray(schema.invoiceLineItems.invoiceId, ids))
          .orderBy(asc(schema.invoiceLineItems.sortOrder))
      : [];
    const byInvoice = new Map<string, LineItemRow[]>();
    for (const item of items) {
      const list = byInvoice.get(item.invoiceId) ?? [];
      list.push(item);
      byInvoice.set(item.invoiceId, list);
    }
    return kept.map((r) => {
      // Důvěrný režim: encrypted texts export as a placeholder, the amounts as usual.
      const lineItems = (byInvoice.get(r.invoice.id) ?? []).map(redactSealedItem);
      return {
        ...r,
        invoice: redactSealedInvoice(r.invoice),
        // The buyer as on the document (its snapshot), not today's contact.
        // An encrypted buyer (category "contacts") exports as the placeholder.
        contact: r.contact ? redactSealedContact(applyBuyerSnapshot(r.contact, r.invoice.buyerSnapshot)) : null,
        lineItems,
        totals: computeVatBreakdown(lineItems, { reverseCharge: r.invoice.reverseCharge }),
        encAmounts: amountsSealed(r.invoice) ? r.invoice.encAmounts : null,
      };
    });
  }

  private loadExpenses(db: Db, period: ExportPeriod) {
    return db
      .select()
      .from(schema.expenses)
      .where(and(gte(schema.expenses.expenseDate, period.from), lt(schema.expenses.expenseDate, period.to)))
      .orderBy(asc(schema.expenses.expenseDate));
  }

  async invoicesCsv(db: Db, period: ExportPeriod, filters: ReportFilters = {}, dateBy: ExportDateBy = "issue"): Promise<string> {
    const rows = await this.loadInvoices(db, period, filters, dateBy);
    // RLS scopes this to the caller's own company — its number variables feed the formulas.
    const [tenant] = await db.select({ templateVars: schema.tenants.templateVars, country: schema.tenants.country }).from(schema.tenants).limit(1);
    return invoicesCsvBody(rows, templateVarsOf(tenant?.templateVars), homeCurrencyOf(tenant?.country));
  }

  /**
   * What the browser needs to build the invoice CSV when some amounts are
   * sealed: the same rows in the same order, plain ones with their totals,
   * sealed ones with the envelope. Opened totals never come back here.
   */
  async invoicesCsvInputs(db: Db, period: ExportPeriod, filters: ReportFilters = {}, dateBy: ExportDateBy = "issue"): Promise<SealedCsvInputs> {
    const rows = await this.loadInvoices(db, period, filters, dateBy, "envelope");
    const [tenant] = await db.select({ templateVars: schema.tenants.templateVars, country: schema.tenants.country }).from(schema.tenants).limit(1);
    return {
      home: homeCurrencyOf(tenant?.country),
      companyVars: templateVarsOf(tenant?.templateVars).map((v) => ({ key: v.key, value: v.value })),
      rows: rows.map(({ invoice: i, contact, totals, encAmounts }) => ({
        invoice: {
          invoiceNumber: i.invoiceNumber,
          documentType: i.documentType,
          status: i.status,
          issueDate: i.issueDate,
          taxableSupplyDate: i.taxableSupplyDate,
          dueDate: i.dueDate,
          paidAt: i.paidAt,
          currency: i.currency,
          exchangeRate: i.exchangeRate,
          variableSymbol: i.variableSymbol,
          language: i.language,
          reverseCharge: i.reverseCharge,
          amountPaid: i.amountPaid,
          customFields: i.customFields,
          internalNote: i.internalNote,
        },
        contact: contact ? { legalName: contact.legalName, ico: contact.ico, dic: contact.dic } : null,
        // A sealed document's plain totals are the placeholder's zeros.
        totals: encAmounts ? null : totals,
        encAmounts,
      })),
    };
  }

  async expensesCsv(db: Db, period: ExportPeriod): Promise<string> {
    const rows = await this.loadExpenses(db, period);
    return csv([
      ["Datum", "Dodavatel", "IČO", "Číslo dokladu", "VS", "Popis", "Kategorie", "Částka s DPH", "Sazba DPH %", "Měna", "Splatnost", "Uhrazeno", "Interní poznámka"],
      ...rows.map((e) => [
        csDate(e.expenseDate),
        e.supplierNameRaw,
        e.supplierIco,
        e.documentNumber,
        e.variableSymbol,
        e.description,
        e.category,
        Number(e.amount),
        Number(e.vatRate).toString(),
        e.currency,
        csDate(e.dueDate),
        csDate(e.paidAt),
        e.note,
      ]),
    ]);
  }

  /** The shared builders' input: plain documents with their totals. */
  private async accountingFile(db: Db, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<AccountingFileInput> {
    const invoices = await this.loadInvoices(db, period);
    const expenses = await this.loadExpenses(db, period);
    return { period, ico: tenant.ico, home: tenantHomeCurrencyOf(tenant), invoices, expenses };
  }

  async pohodaXml(db: Db, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<string> {
    return pohodaXml(await this.accountingFile(db, period, tenant));
  }

  /**
   * The same documents as a Money S3 `MoneyData` file (Soubor → Import →
   * XML), element names and order per Solitea's published XSD.
   */
  async moneyS3Xml(db: Db, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<string> {
    return moneyS3Xml(await this.accountingFile(db, period, tenant));
  }

  /**
   * What the browser needs to build the Pohoda or Money S3 file when some
   * amounts are sealed: the same documents in the same order, sealed ones
   * with their totals envelope and each line's envelope instead of totals.
   */
  async accountingInputs(db: Db, format: AccountingFormat, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<SealedAccountingInputs> {
    const invoices = await this.loadInvoices(db, period, {}, "issue", "envelope");
    const expenses = await this.loadExpenses(db, period);
    return {
      format,
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      ico: tenant.ico,
      home: tenantHomeCurrencyOf(tenant),
      invoices: invoices.map(({ invoice: i, contact: c, lineItems, totals, encAmounts }) => ({
        invoice: {
          invoiceNumber: i.invoiceNumber,
          documentType: i.documentType,
          variableSymbol: i.variableSymbol,
          constantSymbol: i.constantSymbol,
          specificSymbol: i.specificSymbol,
          issueDate: i.issueDate,
          taxableSupplyDate: i.taxableSupplyDate,
          dueDate: i.dueDate,
          paymentMethod: i.paymentMethod,
          noteBelow: i.noteBelow,
          internalNote: i.internalNote,
          currency: i.currency,
          exchangeRate: i.exchangeRate,
          reverseCharge: i.reverseCharge,
        },
        contact: c
          ? {
              legalName: c.legalName,
              addressStreet: c.addressStreet,
              addressCity: c.addressCity,
              addressPostalCode: c.addressPostalCode,
              addressCountry: c.addressCountry,
              ico: c.ico,
              dic: c.dic,
            }
          : null,
        lineItems: lineItems.map((li) => ({
          description: li.description,
          unit: li.unit,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          vatRate: li.vatRate,
          discountPercent: li.discountPercent,
          encAmounts: encAmounts ? (li.encAmounts ?? null) : null,
        })),
        // A sealed document's plain totals are the placeholder's zeros.
        totals: encAmounts ? null : { byRate: totals.byRate, totalWithVat: totals.totalWithVat },
        encAmounts,
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        documentNumber: e.documentNumber,
        variableSymbol: e.variableSymbol,
        expenseDate: e.expenseDate,
        dueDate: e.dueDate,
        description: e.description,
        supplierNameRaw: e.supplierNameRaw,
        supplierIco: e.supplierIco,
        note: e.note,
        vatRate: e.vatRate,
        amount: e.amount,
        currency: e.currency,
        reverseCharge: e.reverseCharge,
      })),
    };
  }

  // --- VAT filings (DPHDP3 / DPHKH1 / DPHSHV) -----------------------------

  /**
   * Documents for a VAT period, by the taxable supply date (DUZP, falling
   * back to the issue date) and converted to the home currency at the stored rate or the
   * ČNB rate of that day. Drafts, proformas, quotes and cancelled documents
   * are not taxable supplies; credit notes enter with negative amounts.
   */
  /**
   * Issued tax documents and VAT-bearing expenses of a period, converted to
   * the filing currency by `toHome` (a multiplier per currency, document
   * value and day).
   */
  private async loadVatDocs(
    db: Db,
    period: ExportPeriod,
    toHome: (currency: string, stored: string | null, date: Date) => Promise<number> = (c, s, d) => this.rateFor("CZK", c, s, d),
    /** Also return expenses without a VAT rate (with no parts): the identified-person return warns about foreign ones. */
    withUntaxed = false,
    /** "envelope": a sealed document comes with no parts, its envelope and its rate, for the browser to fill. */
    sealed: "refuse" | "envelope" = "refuse",
  ) {
    const duzp = sql<Date>`coalesce(${schema.invoices.taxableSupplyDate}, ${schema.invoices.issueDate})`;
    const rows = await db
      .select({ invoice: schema.invoices, contact: schema.contacts })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(
        and(
          isNotNull(schema.invoices.invoiceNumber),
          inArray(schema.invoices.documentType, ["invoice", "credit_note"]),
          notInArray(schema.invoices.status, ["draft", "pending_review", "cancelled"]),
          sql`${duzp} >= ${period.from.toISOString()}`,
          sql`${duzp} < ${period.to.toISOString()}`,
        ),
      )
      .orderBy(asc(schema.invoices.invoiceNumber));
    // A VAT return without the sealed documents would be a wrong filing: refused, or built in the browser.
    if (sealed === "refuse") refuseSealedRows(rows.map((r) => r.invoice));
    const ids = rows.map((r) => r.invoice.id);
    const items = ids.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids))
      : [];
    // A credit note is reported against the invoice it corrects (SK KV C.1).
    const relatedIds = [...new Set(rows.map((r) => r.invoice.relatedInvoiceId).filter((id): id is string => !!id))];
    const relatedNumbers = new Map(
      relatedIds.length
        ? (
            await db
              .select({ id: schema.invoices.id, number: schema.invoices.invoiceNumber })
              .from(schema.invoices)
              .where(inArray(schema.invoices.id, relatedIds))
          ).map((r) => [r.id, r.number])
        : [],
    );

    const issued: (FilingIssuedDoc & { encAmounts?: string; rate?: number })[] = [];
    for (const { invoice, contact: liveContact } of rows) {
      // Kontrolní hlášení needs the buyer's DIČ as on the document.
      const contact = liveContact ? applyBuyerSnapshot(liveContact, invoice.buyerSnapshot) : null;
      const taxableDate = invoice.taxableSupplyDate ?? invoice.issueDate!;
      // VAT needs the official rate of the DUZP (§ 38 ZDPH): a document issued
      // with the old "annual" setting stores the jednotný kurz instead.
      const rate = await toHome(invoice.currency, invoice.exchangeRateMode === "annual" ? null : invoice.exchangeRate, taxableDate);
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      const sealedDoc = amountsSealed(invoice);
      issued.push({
        ...(sealedDoc ? { encAmounts: invoice.encAmounts!, rate, parts: [], totalCzk: 0 } : vatPartsOf(totals, rate)),
        number: invoice.invoiceNumber!,
        customerDic: contact?.dic ?? null,
        customerCountry: contact?.addressCountry ?? "CZ",
        taxableDate,
        reverseCharge: invoice.reverseCharge,
        reverseChargeCode: invoice.reverseChargeCode,
        correctsNumber:
          invoice.documentType === "credit_note" && invoice.relatedInvoiceId
            ? (relatedNumbers.get(invoice.relatedInvoiceId) ?? null)
            : null,
      });
    }

    const expenseRows = await db
      .select({ expense: schema.expenses, contact: schema.contacts })
      .from(schema.expenses)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.expenses.supplierContactId))
      .where(
        and(
          gte(schema.expenses.expenseDate, period.from),
          lt(schema.expenses.expenseDate, period.to),
          withUntaxed ? undefined : ne(schema.expenses.vatRate, "0"),
        ),
      )
      .orderBy(asc(schema.expenses.expenseDate));
    const received: VatReceivedDoc[] = [];
    for (const { expense, contact } of expenseRows) {
      const vatRate = Number(expense.vatRate);
      const doc = {
        number: expense.documentNumber ?? "",
        supplierDic: expense.supplierDic ?? contact?.dic ?? null,
        supplierCountry: contact?.addressCountry ?? null,
        taxableDate: expense.expenseDate,
        reverseCharge: expense.reverseCharge,
        reverseChargeCode: expense.reverseChargeCode,
      };
      // Nothing to convert, and no rate lookup that could fail the export.
      if (vatRate === 0) {
        received.push({ ...doc, parts: [], totalCzk: 0 });
        continue;
      }
      const rate = await toHome(expense.currency, expense.exchangeRate, expense.expenseDate);
      const { base, vat } = expenseVatParts(Number(expense.amount) * rate, vatRate, expense.reverseCharge);
      received.push({ ...doc, parts: [{ ratePercent: vatRate, base, vat }], totalCzk: base + vat });
    }
    return { issued, received };
  }

  /** Home currency per 1 unit of `currency`: the rate stored at issue, else the official one of that day. */
  private async rateFor(home: HomeCurrency, currency: string, stored: string | null, date: Date): Promise<number> {
    if (currency === home) return 1;
    if (stored) return Number(stored);
    const rate = await getHomeRate(home, currency, date);
    if (rate == null) throw new VatRateUnavailableError(currency, date, home === "EUR" ? "ECB" : "ČNB");
    return rate;
  }

  /**
   * Income and expenses of a calendar year, converted to the home currency. Cash basis
   * (daňová evidence, the default): invoices and credit notes by the day they
   * were paid, expenses by the day paid (or dated, when no payment is
   * recorded). Accrual basis (účetnictví): issued invoices by DUZP (issue date
   * when there is none), expenses by their date. VAT payers count amounts
   * without VAT.
   * Everything is converted to the home currency (CZK, EUR for a Slovak
   * company) at each document's rate, or at the
   * year's jednotný kurz when the company chose it for reports
   * (`opts.rates`, uniform-rate.ts).
   */
  async annualSummary(
    db: Db,
    year: number,
    opts: {
      vatPayer: boolean;
      flatRate: FlatRate | null;
      paidSocial?: number;
      paidHealth?: number;
      basis?: AccountingBasis;
      rates?: ReportRates;
      /** EUR for a Slovak company: its income and expenses are summed in euros. */
      homeCurrency?: HomeCurrency;
    },
  ) {
    const home = opts.homeCurrency ?? "CZK";
    const eur = home === "EUR";
    const rates = opts.rates ?? new ReportRates(false, [], new Date(), home);
    // A Slovak company counts in euros at the ECB rate (§ 24 zákona
    // č. 431/2002 Z. z.); `rates` never applies the Czech jednotný kurz to it.
    const toHome = async (currency: string, stored: number | null, day: Date): Promise<number | null> =>
      (await rates.rate(currency, stored, day, year)) ?? (await getHomeRate(home, currency, day));
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    const accrual = opts.basis === "accrual";
    const earnedOn = sql`coalesce(${schema.invoices.taxableSupplyDate}, ${schema.invoices.issueDate})`;
    const found = await db
      .select()
      .from(schema.invoices)
      .where(
        and(
          isNotNull(schema.invoices.invoiceNumber),
          inArray(schema.invoices.documentType, ["invoice", "credit_note"]),
          ...(accrual
            ? [
                inArray(schema.invoices.status, ["issued", "paid"]),
                sql`${earnedOn} >= ${from.toISOString()}`,
                sql`${earnedOn} < ${to.toISOString()}`,
              ]
            : [eq(schema.invoices.status, "paid"), gte(schema.invoices.paidAt, from), lt(schema.invoices.paidAt, to)]),
        ),
      );
    // Sealed amounts are summed in the browser (`sealedDocs`, with the rate picked here); the files built from this summary refuse them (controller).
    const { plain: invoices, sealed } = splitSealed(found);
    const rateDayOf = (invoice: InvoiceRow) => (accrual ? (invoice.taxableSupplyDate ?? invoice.issueDate) : invoice.paidAt) ?? invoice.createdAt;
    const sealedDocs: SealedIncomeDoc[] = [];
    for (const invoice of found) {
      if (!amountsSealed(invoice)) continue;
      const rate = await toHome(invoice.currency, Number(invoice.exchangeRate) || null, rateDayOf(invoice));
      sealedDocs.push({ encAmounts: invoice.encAmounts!, documentType: invoice.documentType, rate });
    }
    const ids = invoices.map((i) => i.id);
    const items = ids.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)) : [];
    let income = 0;
    let missingRates = 0;
    for (const invoice of invoices) {
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      const rate = await toHome(invoice.currency, Number(invoice.exchangeRate) || null, rateDayOf(invoice));
      if (rate == null) {
        missingRates++;
        continue;
      }
      income += annualIncomeOf(totals, invoice.documentType, rate, opts.vatPayer);
    }

    const paidOn = accrual ? sql`${schema.expenses.expenseDate}` : sql`coalesce(${schema.expenses.paidAt}, ${schema.expenses.expenseDate})`;
    const expenses = await db
      .select()
      .from(schema.expenses)
      .where(and(sql`${paidOn} >= ${from.toISOString()}`, sql`${paidOn} < ${to.toISOString()}`));
    let actualExpenses = 0;
    /** The same sums by expense category ("" = none), for the tax-return basis. */
    const byCategory: Record<string, number> = {};
    for (const e of expenses) {
      const rate = await toHome(e.currency, Number(e.exchangeRate) || null, e.paidAt ?? e.expenseDate);
      if (rate == null) {
        missingRates++;
        continue;
      }
      const total = Number(e.amount) * rate;
      const counted = opts.vatPayer ? expenseVatParts(total, Number(e.vatRate), e.reverseCharge).base : total;
      actualExpenses += counted;
      const key = e.category ?? "";
      byCategory[key] = (byCategory[key] ?? 0) + counted;
    }

    return {
      ...computeAnnualSummary({ year, income, actualExpenses, flatRate: opts.flatRate, paidSocial: opts.paidSocial, paidHealth: opts.paidHealth }),
      vatPayer: opts.vatPayer,
      basis: opts.basis ?? "cash",
      /** Which rate converted foreign documents: their own, or the year's jednotný kurz. */
      rateMode: rates.annual && !eur ? ("annual" as const) : ("daily" as const),
      currency: eur ? ("EUR" as const) : ("CZK" as const),
      counts: { invoices: invoices.length, expenses: expenses.length, missingRates },
      byCategory,
      /** The plain documents' income before rounding, for the browser to add the sealed ones to. */
      plainIncome: income,
      /** Documents with sealed amounts, left out of `income`. */
      sealed,
      /** The same documents with their envelope and rate, for the browser. */
      sealedDocs,
    };
  }

  async vatReturn(
    db: Db,
    kind: CzVatFilingKind,
    period: ExportPeriod,
    vatPeriod: VatPeriod,
    tenant: typeof schema.tenants.$inferSelect,
  ): Promise<{ body: string | null; warnings: VatExportWarning[] }> {
    const identified = tenant.vatStatus === "identified";
    const { issued, received } = await this.loadVatDocs(db, period, undefined, identified && kind === "dp3");
    return buildCzVatFiling(kind, { issued, received, submitter: submitterFromTenant(tenant), period: vatPeriod, identified });
  }

  /**
   * Slovak VAT filings (DPHv25, KVDPHv25, SVDPHv20) in EUR. Foreign
   * currencies use the rate stored at issue, else the ECB rate of the day
   * before the tax point (§ 26 ods. 1 ZDPH).
   */
  async vatReturnSk(
    db: Db,
    kind: SkVatFilingKind,
    period: ExportPeriod,
    vatPeriod: VatPeriod,
    tenant: typeof schema.tenants.$inferSelect,
  ): Promise<string | null> {
    const { issued, received } = await this.loadVatDocs(db, period, (c, s, d) => this.rateFor("EUR", c, s, d));
    return buildSkVatFiling(kind, { issued, received, submitter: skSubmitterFromTenant(tenant), period: vatPeriod });
  }

  /**
   * Whether a VAT filing of the period has anything in it, asked of the same
   * documents and builders as the download (the deadline reminder e-mail,
   * src/exports/vat-filing-reminders.cron.ts). Sealed documents come in as
   * envelopes with no amounts: they still count for the filing being due (a
   * sale to an EU business is one by its buyer alone), but nothing sealed
   * ever reaches `xml`. `xml` is null when the filing is not due.
   */
  async vatFilingCheck(
    db: Db,
    filing: { country: "CZ"; kind: CzVatFilingKind } | { country: "SK"; kind: SkVatFilingKind },
    period: ExportPeriod,
    vatPeriod: VatPeriod,
    tenant: typeof schema.tenants.$inferSelect,
  ): Promise<{ due: boolean; xml: string | null; warnings: VatExportWarning[]; sealed: boolean }> {
    if (filing.country === "SK") {
      const { issued, received } = await this.loadVatDocs(db, period, (c, s, d) => this.rateFor("EUR", c, s, d), false, "envelope");
      const xml = buildSkVatFiling(filing.kind, { issued, received, submitter: skSubmitterFromTenant(tenant), period: vatPeriod });
      return { due: xml !== null, xml, warnings: [], sealed: issued.some((d) => !!d.encAmounts) };
    }
    const identified = tenant.vatStatus === "identified";
    const { issued, received } = await this.loadVatDocs(db, period, undefined, identified && filing.kind === "dp3", "envelope");
    const { body, warnings } = buildCzVatFiling(filing.kind, { issued, received, submitter: submitterFromTenant(tenant), period: vatPeriod, identified });
    // Its base is sealed, so the identified person's return leaves ř. 21 out, yet the sale makes the return due.
    const sealedEuSale = issued.some((d) => !!d.encAmounts && classifyIssued(d) === "eu");
    // A foreign purchase with no reverse-charge rate: the tax can't be worked out, but the return is most likely due.
    const unmarked = warnings.some((w) => w.code === "foreign_purchase_unmarked");
    return { due: body !== null || sealedEuSale || unmarked, xml: body, warnings, sealed: issued.some((d) => !!d.encAmounts) };
  }

  /**
   * What the browser needs to build a VAT filing when some documents have
   * sealed amounts: the same documents the server would file, the sealed
   * ones without parts but with their envelope and the rate the server picked
   * for them, so the browser converts exactly as the server does.
   */
  async vatInputs(
    db: Db,
    filing: { country: "CZ"; kind: CzVatFilingKind } | { country: "SK"; kind: SkVatFilingKind },
    period: ExportPeriod,
    vatPeriod: VatPeriod,
    tenant: typeof schema.tenants.$inferSelect,
  ): Promise<SealedVatInputs> {
    if (filing.country === "SK") {
      const { issued, received } = await this.loadVatDocs(db, period, (c, s, d) => this.rateFor("EUR", c, s, d), false, "envelope");
      return { ...filing, submitter: skSubmitterFromTenant(tenant), period: vatPeriod, ...wire(issued, received) };
    }
    const identified = tenant.vatStatus === "identified";
    const { issued, received } = await this.loadVatDocs(db, period, undefined, identified && filing.kind === "dp3", "envelope");
    return { ...filing, identified, submitter: submitterFromTenant(tenant), period: vatPeriod, ...wire(issued, received) };
  }
}

/** The filing documents as the JSON the browser gets (dates as ISO strings). */
function wire(issued: (FilingIssuedDoc & { encAmounts?: string; rate?: number })[], received: VatReceivedDoc[]) {
  return {
    issued: issued.map((d) => ({ ...d, taxableDate: d.taxableDate.toISOString() })),
    received: received.map((d) => ({ ...d, taxableDate: d.taxableDate.toISOString() })),
  };
}

/** A foreign-currency document whose ČNB / ECB rate could not be fetched. */
export class VatRateUnavailableError extends Error {
  constructor(
    readonly currency: string,
    readonly date: Date,
    readonly source: "ČNB" | "ECB" = "ČNB",
  ) {
    super(`${source} rate for ${currency} on ${isoDate(date)} is not available`);
  }
}
