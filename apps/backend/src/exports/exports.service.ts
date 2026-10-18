import { netAfterTaxes } from "../invoices/amount-vars";
import { displayCustomField, resolveVars } from "../invoices/custom-fields";
import { type TemplateVar, templateVarsOf } from "../tenants/template-vars";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { matchesFilters, type ReportFilters } from "../dashboard/report-filters";
import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNotNull, lt, ne, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeVatBreakdown, type InvoiceVatBreakdown, round2 } from "../invoices/invoice-total.util";
import { type AccountingBasis, computeAnnualSummary, type FlatRate } from "./annual-summary";
import { getCnbRate } from "./cnb-rates";
import { ReportRates } from "./uniform-rate";
import {
  generateDphDp3,
  generateDphKh1,
  generateDphShv,
  submitterFromTenant,
  type VatIssuedDoc,
  type VatPeriod,
  type VatReceivedDoc,
} from "./vat-returns";

type Db = PostgresJsDatabase<typeof schema>;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;

export interface ExportPeriod {
  from: Date;
  /** Exclusive. */
  to: Date;
}

const TYPE_LABEL: Record<InvoiceRow["documentType"], string> = {
  invoice: "Faktura",
  proforma: "Zálohová faktura",
  credit_note: "Dobropis",
  quote: "Nabídka",
};

const STATUS_LABEL: Record<InvoiceRow["status"], string> = {
  draft: "Koncept",
  pending_review: "Ke kontrole",
  issued: "Vystaveno",
  paid: "Uhrazeno",
  cancelled: "Stornováno",
};

const POHODA_INVOICE_TYPE: Partial<Record<InvoiceRow["documentType"], string>> = {
  invoice: "issuedInvoice",
  credit_note: "issuedCreditNotice",
  proforma: "issuedAdvanceInvoice",
};

const POHODA_PAYMENT: Record<InvoiceRow["paymentMethod"], string> = {
  bank_transfer: "draft",
  cash: "cash",
  card: "creditcard",
  cash_on_delivery: "delivery",
  other: "draft",
};

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

/** Czech Excel opens `;`-separated, comma-decimal, BOM-prefixed UTF-8 cleanly. */
function csv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v == null) return "";
    // Text starting like a formula (=, +, @) is prefixed with ' so Excel shows it instead of running it.
    const s = typeof v === "number" ? v.toFixed(2).replace(".", ",") : String(v).replace(/^([=+@\t\r])/, "'$1");
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

function xml(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

const MONEY_PAYMENT: Record<InvoiceRow["paymentMethod"], string> = {
  bank_transfer: "převodem",
  cash: "hotově",
  card: "kartou",
  cash_on_delivery: "dobírkou",
  other: "jinak",
};

/** Closes a non-stock item; the XSD requires Protizapis (only meaningful for deposit deductions). */
const NESKL_TAIL = "<Protizapis>false</Protizapis></NesklPolozka>";

/** An optional XML element: omitted when the value is empty. */
function el(tag: string, v: string | number | null | undefined): string {
  return v == null || v === "" ? "" : `<${tag}>${xml(v)}</${tag}>`;
}

function money(n: number): string {
  return round2(n).toFixed(2);
}

type RateBucket = { vatRatePercent: number; totalWithoutVat: number; vatAmount: number };

/** Money's VAT summary: the reduced rate lives in the "5" slots, the standard one in "22". */
export function moneyVatSummary(byRate: RateBucket[]): string {
  const sum = (pick: (r: RateBucket) => boolean, key: "totalWithoutVat" | "vatAmount") =>
    money(byRate.filter(pick).reduce((a, r) => a + r[key], 0));
  const zero = (r: RateBucket) => r.vatRatePercent <= 0;
  const low = (r: RateBucket) => r.vatRatePercent > 0 && r.vatRatePercent < 19;
  const high = (r: RateBucket) => r.vatRatePercent >= 19;
  return (
    `<SouhrnDPH><Zaklad0>${sum(zero, "totalWithoutVat")}</Zaklad0>` +
    `<Zaklad5>${sum(low, "totalWithoutVat")}</Zaklad5><Zaklad22>${sum(high, "totalWithoutVat")}</Zaklad22>` +
    `<DPH5>${sum(low, "vatAmount")}</DPH5><DPH22>${sum(high, "vatAmount")}</DPH22></SouhrnDPH>`
  );
}

/** Header totals: plain for CZK, inside `Valuty` (with the stored rate, if any) for a foreign currency. */
export function moneyTotals(currency: string, rate: string | null, byRate: RateBucket[], total: number): string {
  if (currency === "CZK") return moneyVatSummary(byRate) + `<Celkem>${money(total)}</Celkem>`;
  // Without a stored rate Money converts with its own exchange-rate list.
  return (
    `<Valuty><Mena><Kod>${xml(currency)}</Kod><Mnozstvi>1</Mnozstvi>` +
    (rate ? `<Kurs>${Math.round(Number(rate) * 10000) / 10000}</Kurs>` : "") +
    `</Mena>${moneyVatSummary(byRate)}<Celkem>${money(total)}</Celkem></Valuty>`
  );
}

/** Pohoda's VAT rate classes; the exact percentage is sent alongside. */
function pohodaRate(percent: number): string {
  if (percent <= 0) return "none";
  if (percent >= 19) return "high";
  if (percent >= 10 && percent <= 15) return "low";
  return "third";
}

/** Which date puts a document into the export period. */
export type ExportDateBy = "issue" | "supply";

export interface CsvInvoiceRow {
  invoice: InvoiceRow;
  contact: ContactRow | null;
  totals: InvoiceVatBreakdown;
}

const percentLabel = (p: number) => `${String(p).replace(".", ",")} %`;

/**
 * The accountant's invoice list: one row per document, the columns Czech
 * accountants ask for first (dates, customer IDs, base and VAT per rate,
 * CZK rate and CZK total), then the extras. Rate columns are made for every
 * VAT rate present, highest first. The CZK rate is the one stored on the
 * document at issue; a foreign document without one gets an empty CZK total.
 */
export function invoicesCsvBody(rows: CsvInvoiceRow[], companyVars: TemplateVar[] = []): string {
  const rates = [...new Set(rows.flatMap((r) => r.totals.byRate.map((b) => b.vatRatePercent)))].sort((a, b) => b - a);
  const rateHeaders = rates.flatMap((p) => (p > 0 ? [`Základ ${percentLabel(p)}`, `DPH ${percentLabel(p)}`] : [`Základ ${percentLabel(p)}`]));
  return csv([
    [
      "Číslo",
      "Typ",
      "Vystaveno",
      "DUZP",
      "Splatnost",
      "Uhrazeno",
      "Odběratel",
      "IČO",
      "DIČ",
      "Měna",
      ...rateHeaders,
      "Základ celkem",
      "DPH celkem",
      "Celkem",
      "Kurz ČNB",
      "Celkem v CZK",
      "VS",
      "Stav",
      "Jazyk",
      "Přenesená daňová povinnost",
      "Uhrazená částka",
      "Čistý odhad (po dani a pojištění, paušál 60 %)",
      "Vlastní pole",
      "Interní poznámka",
    ],
    ...rows.map(({ invoice, contact, totals }) => {
      const perRate = rates.flatMap((p) => {
        const b = totals.byRate.find((x) => x.vatRatePercent === p);
        return p > 0 ? [b?.totalWithoutVat ?? null, b?.vatAmount ?? null] : [b?.totalWithoutVat ?? null];
      });
      const rate = invoice.currency === "CZK" ? 1 : invoice.exchangeRate == null ? null : Number(invoice.exchangeRate);
      return [
        invoice.invoiceNumber,
        TYPE_LABEL[invoice.documentType],
        csDate(invoice.issueDate),
        csDate(invoice.taxableSupplyDate ?? invoice.issueDate),
        csDate(invoice.dueDate),
        csDate(invoice.paidAt),
        contact?.legalName,
        contact?.ico,
        contact?.dic,
        invoice.currency,
        ...perRate,
        totals.totalWithoutVat,
        totals.totalVat,
        totals.totalWithVat,
        // Up to 6 decimals as stored; a plain number cell would round it to 2.
        rate == null ? null : String(rate).replace(".", ","),
        rate == null ? null : round2(totals.totalWithVat * rate),
        invoice.variableSymbol,
        STATUS_LABEL[invoice.status],
        invoice.language,
        invoice.reverseCharge ? "ano" : "",
        Number(invoice.amountPaid ?? 0),
        netAfterTaxes(totals.totalWithoutVat),
        // Internal ones included: the export goes to the company / its accountant.
        (invoice.customFields ?? [])
          .map((f) => `${f.label}: ${displayCustomField(f, resolveVars(invoice.customFields, totals, invoice.amountPaid, companyVars), (n) => n.toFixed(2).replace(".", ","), (v) => v)}${f.internal ? " (interní)" : ""}`)
          .join(" | "),
        invoice.internalNote,
      ];
    }),
  ]);
}

/**
 * Accountant exports for a period (by issue date): CSV for spreadsheets and
 * a Pohoda XML dataPack (issued invoices, credit notes, proformas and
 * received expenses) that Pohoda imports via Soubor → Datová komunikace →
 * XML import. Only issued documents (with a number) are exported.
 */
@Injectable()
export class ExportsService {
  private async loadInvoices(db: Db, period: ExportPeriod, filters: ReportFilters = {}, dateBy: ExportDateBy = "issue") {
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
      const lineItems = byInvoice.get(r.invoice.id) ?? [];
      return {
        ...r,
        // The buyer as on the document (its snapshot), not today's contact.
        contact: r.contact ? applyBuyerSnapshot(r.contact, r.invoice.buyerSnapshot) : null,
        lineItems,
        totals: computeVatBreakdown(lineItems, { reverseCharge: r.invoice.reverseCharge }),
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
    const [tenant] = await db.select({ templateVars: schema.tenants.templateVars }).from(schema.tenants).limit(1);
    return invoicesCsvBody(rows, templateVarsOf(tenant?.templateVars));
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

  async pohodaXml(db: Db, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<string> {
    const invoices = await this.loadInvoices(db, period);
    const expenses = await this.loadExpenses(db, period);
    const packId = `billanta-${isoDate(period.from)}`;

    const partner = (c: ContactRow | null) =>
      c
        ? `<inv:partnerIdentity><typ:address>` +
          `<typ:company>${xml(c.legalName)}</typ:company>` +
          `<typ:city>${xml(c.addressCity)}</typ:city>` +
          `<typ:street>${xml(c.addressStreet)}</typ:street>` +
          `<typ:zip>${xml(c.addressPostalCode)}</typ:zip>` +
          (c.ico ? `<typ:ico>${xml(c.ico)}</typ:ico>` : "") +
          (c.dic ? `<typ:dic>${xml(c.dic)}</typ:dic>` : "") +
          `</typ:address></inv:partnerIdentity>`
        : "";

    const items: string[] = [];
    for (const { invoice, contact, lineItems } of invoices) {
      const type = POHODA_INVOICE_TYPE[invoice.documentType];
      if (!type) continue;
      const foreign = invoice.currency !== "CZK";
      const priceTag = foreign ? "inv:foreignCurrency" : "inv:homeCurrency";
      const lines = lineItems
        .map((li) => {
          const rate = invoice.reverseCharge ? 0 : Number(li.vatRate ?? 0);
          return (
            `<inv:invoiceItem>` +
            `<inv:text>${xml(li.description.slice(0, 90))}</inv:text>` +
            `<inv:quantity>${Number(li.quantity)}</inv:quantity>` +
            (li.unit ? `<inv:unit>${xml(li.unit)}</inv:unit>` : "") +
            `<inv:payVAT>false</inv:payVAT>` +
            `<inv:rateVAT>${pohodaRate(rate)}</inv:rateVAT>` +
            (rate > 0 ? `<inv:percentVAT>${rate}</inv:percentVAT>` : "") +
            (Number(li.discountPercent ?? 0) > 0
              ? `<inv:discountPercentage>${Number(li.discountPercent)}</inv:discountPercentage>`
              : "") +
            `<${priceTag}><typ:unitPrice>${Math.round(Number(li.unitPrice) * 10000) / 10000}</typ:unitPrice></${priceTag}>` +
            `</inv:invoiceItem>`
          );
        })
        .join("");

      items.push(
        `<dat:dataPackItem id="${xml(invoice.invoiceNumber)}" version="2.0">` +
          `<inv:invoice version="2.0"><inv:invoiceHeader>` +
          `<inv:invoiceType>${type}</inv:invoiceType>` +
          `<inv:number><typ:numberRequested>${xml(invoice.invoiceNumber)}</typ:numberRequested></inv:number>` +
          (invoice.variableSymbol ? `<inv:symVar>${xml(invoice.variableSymbol)}</inv:symVar>` : "") +
          `<inv:date>${isoDate(invoice.issueDate)}</inv:date>` +
          (invoice.documentType !== "proforma"
            ? `<inv:dateTax>${isoDate(invoice.taxableSupplyDate ?? invoice.issueDate)}</inv:dateTax>`
            : "") +
          (invoice.dueDate ? `<inv:dateDue>${isoDate(invoice.dueDate)}</inv:dateDue>` : "") +
          `<inv:text>${xml((lineItems[0]?.description ?? TYPE_LABEL[invoice.documentType]).slice(0, 240))}</inv:text>` +
          partner(contact) +
          `<inv:paymentType><typ:paymentType>${POHODA_PAYMENT[invoice.paymentMethod]}</typ:paymentType></inv:paymentType>` +
          (invoice.constantSymbol ? `<inv:symConst>${xml(invoice.constantSymbol)}</inv:symConst>` : "") +
          (invoice.specificSymbol ? `<inv:symSpec>${xml(invoice.specificSymbol)}</inv:symSpec>` : "") +
          (invoice.noteBelow ? `<inv:note>${xml(invoice.noteBelow)}</inv:note>` : "") +
          (invoice.internalNote ? `<inv:intNote>${xml(invoice.internalNote)}</inv:intNote>` : "") +
          `</inv:invoiceHeader>` +
          `<inv:invoiceDetail>${lines}</inv:invoiceDetail>` +
          `<inv:invoiceSummary><inv:roundingDocument>none</inv:roundingDocument>` +
          (foreign
            ? `<inv:foreignCurrency><typ:currency><typ:ids>${xml(invoice.currency)}</typ:ids></typ:currency></inv:foreignCurrency>`
            : "") +
          `</inv:invoiceSummary>` +
          `</inv:invoice></dat:dataPackItem>`,
      );
    }

    for (const e of expenses) {
      const rate = Number(e.vatRate);
      const foreign = e.currency !== "CZK";
      const priceTag = foreign ? "inv:foreignCurrency" : "inv:homeCurrency";
      const ref = e.documentNumber || e.id.slice(0, 8);
      items.push(
        `<dat:dataPackItem id="exp-${xml(e.id)}" version="2.0">` +
          `<inv:invoice version="2.0"><inv:invoiceHeader>` +
          `<inv:invoiceType>receivedInvoice</inv:invoiceType>` +
          `<inv:originalDocument>${xml(ref)}</inv:originalDocument>` +
          (e.variableSymbol ? `<inv:symVar>${xml(e.variableSymbol)}</inv:symVar>` : "") +
          `<inv:date>${isoDate(e.expenseDate)}</inv:date>` +
          `<inv:dateTax>${isoDate(e.expenseDate)}</inv:dateTax>` +
          (e.dueDate ? `<inv:dateDue>${isoDate(e.dueDate)}</inv:dateDue>` : "") +
          `<inv:text>${xml(e.description.slice(0, 240))}</inv:text>` +
          (e.supplierNameRaw || e.supplierIco
            ? `<inv:partnerIdentity><typ:address>` +
              `<typ:company>${xml(e.supplierNameRaw)}</typ:company>` +
              (e.supplierIco ? `<typ:ico>${xml(e.supplierIco)}</typ:ico>` : "") +
              `</typ:address></inv:partnerIdentity>`
            : "") +
          (e.note ? `<inv:intNote>${xml(e.note)}</inv:intNote>` : "") +
          `</inv:invoiceHeader><inv:invoiceDetail><inv:invoiceItem>` +
          `<inv:text>${xml(e.description.slice(0, 90))}</inv:text>` +
          `<inv:quantity>1</inv:quantity>` +
          `<inv:payVAT>true</inv:payVAT>` +
          `<inv:rateVAT>${pohodaRate(rate)}</inv:rateVAT>` +
          (rate > 0 ? `<inv:percentVAT>${rate}</inv:percentVAT>` : "") +
          `<${priceTag}><typ:unitPrice>${round2(Number(e.amount))}</typ:unitPrice></${priceTag}>` +
          `</inv:invoiceItem></inv:invoiceDetail>` +
          `<inv:invoiceSummary><inv:roundingDocument>none</inv:roundingDocument>` +
          (foreign
            ? `<inv:foreignCurrency><typ:currency><typ:ids>${xml(e.currency)}</typ:ids></typ:currency></inv:foreignCurrency>`
            : "") +
          `</inv:invoiceSummary></inv:invoice></dat:dataPackItem>`,
      );
    }

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<dat:dataPack id="${xml(packId)}" ico="${xml(tenant.ico)}" application="Billanta" version="2.0" ` +
      `note="Export ${isoDate(period.from)} – ${isoDate(new Date(period.to.getTime() - 1))}" ` +
      `xmlns:dat="http://www.stormware.cz/schema/version_2/data.xsd" ` +
      `xmlns:inv="http://www.stormware.cz/schema/version_2/invoice.xsd" ` +
      `xmlns:typ="http://www.stormware.cz/schema/version_2/type.xsd">\n` +
      items.join("\n") +
      `\n</dat:dataPack>\n`
    );
  }

  /**
   * The same documents as a Money S3 `MoneyData` file (Soubor → Import →
   * XML), element names and order per Solitea's published XSD. Discounts are
   * folded into the unit price; reverse charge exports with a 0 % rate.
   */
  async moneyS3Xml(db: Db, period: ExportPeriod, tenant: typeof schema.tenants.$inferSelect): Promise<string> {
    const invoices = await this.loadInvoices(db, period);
    const expenses = await this.loadExpenses(db, period);

    const issued = invoices.map(({ invoice, contact, lineItems, totals }) => {
      const foreign = invoice.currency !== "CZK";
      const lines = lineItems
        .map((li) => {
          const rate = invoice.reverseCharge ? 0 : Number(li.vatRate ?? 0);
          const unitPrice = Number(li.unitPrice) * (1 - Number(li.discountPercent ?? 0) / 100);
          const price = Math.round(unitPrice * 10000) / 10000;
          return (
            `<Polozka>${el("Popis", li.description.slice(0, 50))}` +
            (li.description.length > 50 ? el("Poznamka", li.description) : "") +
            `<PocetMJ>${Number(li.quantity)}</PocetMJ><SazbaDPH>${rate}</SazbaDPH>` +
            `<Cena>${foreign ? 0 : price}</Cena><CenaTyp>0</CenaTyp>` +
            (foreign ? `<Valuty>${price}</Valuty>` : "") +
            `<NesklPolozka>${el("MJ", li.unit?.slice(0, 10))}${NESKL_TAIL}</Polozka>`
          );
        })
        .join("");
      // Doklad holds at most 10 characters; a longer number goes to the note.
      const note = [
        invoice.invoiceNumber!.length > 10 ? `Číslo dokladu: ${invoice.invoiceNumber}` : "",
        invoice.internalNote ?? "",
      ].filter(Boolean);
      return (
        `<FaktVyd>` +
        el("Doklad", invoice.invoiceNumber!.slice(0, 10)) +
        el("Popis", (lineItems[0]?.description ?? TYPE_LABEL[invoice.documentType]).slice(0, 50)) +
        el("Vystaveno", isoDate(invoice.issueDate)) +
        (invoice.documentType !== "proforma"
          ? el("PlnenoDPH", isoDate(invoice.taxableSupplyDate ?? invoice.issueDate))
          : "") +
        el("Splatno", isoDate(invoice.dueDate)) +
        el("KonstSym", invoice.constantSymbol) +
        el("VarSymbol", invoice.variableSymbol) +
        el("SpecSymbol", invoice.specificSymbol) +
        `<Druh>${invoice.documentType === "proforma" ? "Z" : "N"}</Druh>` +
        (invoice.documentType === "credit_note" ? `<Dobropis>true</Dobropis>` : "") +
        el("Uhrada", MONEY_PAYMENT[invoice.paymentMethod]) +
        `<SazbaDPH1>12</SazbaDPH1><SazbaDPH2>21</SazbaDPH2>` +
        moneyTotals(invoice.currency, invoice.exchangeRate, totals.byRate, totals.totalWithVat) +
        el("Poznamka", note.join("\n")) +
        el("TextZaFa", invoice.noteBelow) +
        (contact
          ? `<DodOdb>${el("ObchNazev", contact.legalName)}` +
            `<ObchAdresa>${el("Ulice", contact.addressStreet)}${el("Misto", contact.addressCity)}` +
            `${el("PSC", contact.addressPostalCode)}${el("Stat", contact.addressCountry)}</ObchAdresa>` +
            `${el("ICO", contact.ico)}${el("DIC", contact.dic)}</DodOdb>`
          : "") +
        `<SeznamPolozek>${lines}</SeznamPolozek>` +
        `</FaktVyd>`
      );
    });

    const received = expenses.map((e) => {
      const rate = Number(e.vatRate);
      const total = Number(e.amount);
      const base = total / (1 + rate / 100);
      const foreign = e.currency !== "CZK";
      return (
        `<FaktPrij>` +
        el("Popis", e.description.slice(0, 50)) +
        el("Vystaveno", isoDate(e.expenseDate)) +
        el("PlnenoDPH", isoDate(e.expenseDate)) +
        el("Splatno", isoDate(e.dueDate)) +
        el("VarSymbol", e.variableSymbol) +
        el("PrijatDokl", e.documentNumber) +
        `<Druh>N</Druh><SazbaDPH1>12</SazbaDPH1><SazbaDPH2>21</SazbaDPH2>` +
        moneyTotals(e.currency, null, [{ vatRatePercent: rate, totalWithoutVat: base, vatAmount: total - base }], total) +
        el("Poznamka", e.note) +
        (e.supplierNameRaw || e.supplierIco
          ? `<DodOdb>${el("ObchNazev", e.supplierNameRaw)}${el("ICO", e.supplierIco)}</DodOdb>`
          : "") +
        `<SeznamPolozek><Polozka>${el("Popis", e.description.slice(0, 50))}<PocetMJ>1</PocetMJ>` +
        `<SazbaDPH>${rate}</SazbaDPH><Cena>${foreign ? 0 : money(total)}</Cena><CenaTyp>1</CenaTyp>` +
        (foreign ? `<Valuty>${money(total)}</Valuty>` : "") +
        `<NesklPolozka>${NESKL_TAIL}</Polozka></SeznamPolozek>` +
        `</FaktPrij>`
      );
    });

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<MoneyData ${tenant.ico ? `ICAgendy="${xml(tenant.ico)}" ` : ""}` +
      `description="Billanta ${isoDate(period.from)} – ${isoDate(new Date(period.to.getTime() - 1))}" ` +
      `ExpZkratka="Billanta" ExpDate="${isoDate(new Date())}">\n` +
      // The schema wants received invoices before issued ones.
      (received.length ? `<SeznamFaktPrij>\n${received.join("\n")}\n</SeznamFaktPrij>\n` : "") +
      (issued.length ? `<SeznamFaktVyd>\n${issued.join("\n")}\n</SeznamFaktVyd>\n` : "") +
      `</MoneyData>\n`
    );
  }

  // --- VAT filings (DPHDP3 / DPHKH1 / DPHSHV) -----------------------------

  /**
   * Documents for a VAT period, by the taxable supply date (DUZP, falling
   * back to the issue date) and converted to CZK at the stored rate or the
   * ČNB rate of that day. Drafts, proformas, quotes and cancelled documents
   * are not taxable supplies; credit notes enter with negative amounts.
   */
  private async loadVatDocs(db: Db, period: ExportPeriod) {
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
    const ids = rows.map((r) => r.invoice.id);
    const items = ids.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids))
      : [];

    const issued: VatIssuedDoc[] = [];
    for (const { invoice, contact: liveContact } of rows) {
      // Kontrolní hlášení needs the buyer's DIČ as on the document.
      const contact = liveContact ? applyBuyerSnapshot(liveContact, invoice.buyerSnapshot) : null;
      const taxableDate = invoice.taxableSupplyDate ?? invoice.issueDate!;
      // VAT needs the ČNB rate of the DUZP (§ 38 ZDPH): a document issued
      // with the old "annual" setting stores the jednotný kurz instead.
      const rate = await this.rateFor(invoice.currency, invoice.exchangeRateMode === "annual" ? null : invoice.exchangeRate, taxableDate);
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      issued.push({
        number: invoice.invoiceNumber!,
        customerDic: contact?.dic ?? null,
        customerCountry: contact?.addressCountry ?? "CZ",
        taxableDate,
        reverseCharge: invoice.reverseCharge,
        parts: totals.byRate.map((r) => ({
          ratePercent: r.vatRatePercent,
          base: r.totalWithoutVat * rate,
          vat: r.vatAmount * rate,
        })),
        totalCzk: totals.totalWithVat * rate,
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
          ne(schema.expenses.vatRate, "0"),
        ),
      )
      .orderBy(asc(schema.expenses.expenseDate));
    const received: VatReceivedDoc[] = [];
    for (const { expense, contact } of expenseRows) {
      const rate = await this.rateFor(expense.currency, expense.exchangeRate, expense.expenseDate);
      const total = Number(expense.amount) * rate;
      const vatRate = Number(expense.vatRate);
      const base = total / (1 + vatRate / 100);
      received.push({
        number: expense.documentNumber ?? "",
        supplierDic: expense.supplierDic ?? contact?.dic ?? null,
        taxableDate: expense.expenseDate,
        parts: [{ ratePercent: vatRate, base, vat: total - base }],
        totalCzk: total,
      });
    }
    return { issued, received };
  }

  private async rateFor(currency: string, stored: string | null, date: Date): Promise<number> {
    if (currency === "CZK") return 1;
    if (stored) return Number(stored);
    const rate = await getCnbRate(currency, date);
    if (rate == null) throw new VatRateUnavailableError(currency, date);
    return rate;
  }

  /**
   * Income and expenses of a calendar year, converted to CZK. Cash basis
   * (daňová evidence, the default): invoices and credit notes by the day they
   * were paid, expenses by the day paid (or dated, when no payment is
   * recorded). Accrual basis (účetnictví): issued invoices by DUZP (issue date
   * when there is none), expenses by their date. VAT payers count amounts
   * without VAT.
   * Everything is converted to CZK at each document's rate, or at the
   * year's jednotný kurz when the company chose it for reports
   * (`opts.rates`, uniform-rate.ts).
   */
  async annualSummary(
    db: Db,
    year: number,
    opts: { vatPayer: boolean; flatRate: FlatRate | null; paidSocial?: number; paidHealth?: number; basis?: AccountingBasis; rates?: ReportRates },
  ) {
    const rates = opts.rates ?? new ReportRates(false, []);
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    const accrual = opts.basis === "accrual";
    const earnedOn = sql`coalesce(${schema.invoices.taxableSupplyDate}, ${schema.invoices.issueDate})`;
    const invoices = await db
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
    const ids = invoices.map((i) => i.id);
    const items = ids.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)) : [];
    let income = 0;
    let missingRates = 0;
    for (const invoice of invoices) {
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      const amount = opts.vatPayer ? totals.totalWithoutVat : totals.totalWithVat;
      const rateDay = (accrual ? (invoice.taxableSupplyDate ?? invoice.issueDate) : invoice.paidAt) ?? invoice.createdAt;
      const rate = (await rates.rate(invoice.currency, Number(invoice.exchangeRate) || null, rateDay, year)) ?? (await getCnbRate(invoice.currency, rateDay));
      if (rate == null) {
        missingRates++;
        continue;
      }
      income += Math.abs(amount) * rate * (invoice.documentType === "credit_note" ? -1 : 1);
    }

    const paidOn = accrual ? sql`${schema.expenses.expenseDate}` : sql`coalesce(${schema.expenses.paidAt}, ${schema.expenses.expenseDate})`;
    const expenses = await db
      .select()
      .from(schema.expenses)
      .where(and(sql`${paidOn} >= ${from.toISOString()}`, sql`${paidOn} < ${to.toISOString()}`));
    let actualExpenses = 0;
    for (const e of expenses) {
      const rate = (await rates.rate(e.currency, Number(e.exchangeRate) || null, e.paidAt ?? e.expenseDate, year)) ?? (await getCnbRate(e.currency, e.paidAt ?? e.expenseDate));
      if (rate == null) {
        missingRates++;
        continue;
      }
      const total = Number(e.amount) * rate;
      actualExpenses += opts.vatPayer ? total / (1 + Number(e.vatRate) / 100) : total;
    }

    return {
      ...computeAnnualSummary({ year, income, actualExpenses, flatRate: opts.flatRate, paidSocial: opts.paidSocial, paidHealth: opts.paidHealth }),
      vatPayer: opts.vatPayer,
      basis: opts.basis ?? "cash",
      /** Which rate converted foreign documents: their own, or the year's jednotný kurz. */
      rateMode: rates.annual ? ("annual" as const) : ("daily" as const),
      counts: { invoices: invoices.length, expenses: expenses.length, missingRates },
    };
  }

  async vatReturn(
    db: Db,
    kind: "dp3" | "kh1" | "shv",
    period: ExportPeriod,
    vatPeriod: VatPeriod,
    tenant: typeof schema.tenants.$inferSelect,
  ): Promise<string | null> {
    const { issued, received } = await this.loadVatDocs(db, period);
    const submitter = submitterFromTenant(tenant);
    if (kind === "dp3") return generateDphDp3({ issued, received, submitter, period: vatPeriod });
    if (kind === "kh1") return generateDphKh1({ issued, received, submitter, period: vatPeriod });
    return generateDphShv({ issued, submitter, period: vatPeriod });
  }
}

/** A foreign-currency document whose ČNB rate could not be fetched. */
export class VatRateUnavailableError extends Error {
  constructor(
    readonly currency: string,
    readonly date: Date,
  ) {
    super(`ČNB rate for ${currency} on ${isoDate(date)} is not available`);
  }
}
