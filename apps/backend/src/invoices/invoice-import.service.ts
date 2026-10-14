import { BadRequestException, Injectable } from "@nestjs/common";
import { inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { decodeCsvBuffer, parseCsv } from "../contacts/contacts-csv.util";
import { mapInvoiceRows, ownNumberSequence, type ImportedInvoice, type ImportSkip } from "./invoice-import.util";
import { computeInvoiceTotal, round2 } from "./invoice-total.util";
import { BitfakturaError, fetchBitfakturaInvoices, mapBitfakturaInvoices } from "./bitfaktura-import";
import { getCnbRate } from "../exports/cnb-rates";

type TenantDb = PostgresJsDatabase<typeof schema>;

const MAX_IMPORT_INVOICES = 5000;

export interface InvoiceImportResult {
  dryRun: boolean;
  invoices: number;
  contactsCreated: number;
  contactsMatched: number;
  byStatus: Record<"issued" | "paid" | "cancelled", number>;
  totals: Record<string, number>;
  dateFrom: string | null;
  dateTo: string | null;
  skipped: ImportSkip[];
  preview: { number: string; customer: string; issueDate: string; total: number; currency: string; status: string }[];
}

/**
 * "Stěhování": brings the invoice history from another system in as
 * already-issued documents (`source = 'import'`). Nothing is sent, no
 * notifications or webhooks fire, and reminders skip them — they are a
 * record of the past, not new work. Own-format numbers bump the sequence so
 * the next invoice continues the row instead of colliding with it.
 */
@Injectable()
export class InvoiceImportService {
  async importCsv(db: TenantDb, tenantId: string, buffer: Buffer, dryRun: boolean): Promise<InvoiceImportResult> {
    let mapped: ReturnType<typeof mapInvoiceRows>;
    try {
      mapped = mapInvoiceRows(parseCsv(decodeCsvBuffer(buffer)));
    } catch {
      throw new BadRequestException({ error: "unknown_columns" });
    }
    return this.importMapped(db, tenantId, mapped, dryRun);
  }

  /** Reads the history over the BitFaktura API with the user's token (used for this request only, never stored). */
  async importFromBitfaktura(
    db: TenantDb,
    tenantId: string,
    account: string,
    apiToken: string,
    dryRun: boolean,
    fetcher?: Parameters<typeof fetchBitfakturaInvoices>[2],
  ): Promise<InvoiceImportResult> {
    let source: Awaited<ReturnType<typeof fetchBitfakturaInvoices>>;
    try {
      source = await fetchBitfakturaInvoices(account, apiToken, fetcher);
    } catch (error) {
      if (error instanceof BitfakturaError) throw new BadRequestException({ error: error.code });
      throw error;
    }
    return this.importMapped(db, tenantId, mapBitfakturaInvoices(source), dryRun);
  }

  private async importMapped(
    db: TenantDb,
    tenantId: string,
    mapped: { invoices: ImportedInvoice[]; skipped: ImportSkip[] },
    dryRun: boolean,
  ): Promise<InvoiceImportResult> {
    if (mapped.invoices.length > MAX_IMPORT_INVOICES) throw new BadRequestException({ error: "too_many_rows" });

    const skipped = [...mapped.skipped];
    const numbers = mapped.invoices.map((i) => i.invoiceNumber);
    const taken = new Set<string>();
    for (let i = 0; i < numbers.length; i += 500) {
      const rows = await db
        .select({ number: schema.invoices.invoiceNumber })
        .from(schema.invoices)
        .where(inArray(schema.invoices.invoiceNumber, numbers.slice(i, i + 500)));
      rows.forEach((r) => r.number && taken.add(r.number));
    }
    const invoices = mapped.invoices.filter((inv) => {
      if (!taken.has(inv.invoiceNumber)) return true;
      skipped.push({ line: inv.line, number: inv.invoiceNumber, reason: "already_exists" });
      return false;
    });
    skipped.sort((a, b) => a.line - b.line);

    const existing = await db.select({ id: schema.contacts.id, ico: schema.contacts.ico, legalName: schema.contacts.legalName }).from(schema.contacts);
    const byIco = new Map(existing.filter((c) => c.ico).map((c) => [c.ico!, c.id]));
    const byName = new Map(existing.map((c) => [c.legalName.trim().toLowerCase(), c.id]));
    const findContact = (c: ImportedInvoice["customer"]) => (c.ico ? byIco.get(c.ico) : undefined) ?? byName.get(c.legalName.toLowerCase());

    const totalOf = (inv: ImportedInvoice) =>
      computeInvoiceTotal(inv.lines.map((l) => ({ quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatRate: String(l.vatRate) })));

    const result: InvoiceImportResult = {
      dryRun,
      invoices: invoices.length,
      contactsCreated: 0,
      contactsMatched: 0,
      byStatus: { issued: 0, paid: 0, cancelled: 0 },
      totals: {},
      dateFrom: null,
      dateTo: null,
      skipped,
      preview: [],
    };
    const newCustomers = new Set<string>();
    const matchedCustomers = new Set<string>();
    for (const inv of invoices) {
      const total = totalOf(inv);
      result.byStatus[inv.status]++;
      if (inv.status !== "cancelled") result.totals[inv.currency] = round2((result.totals[inv.currency] ?? 0) + total);
      const day = inv.issueDate.toISOString().slice(0, 10);
      if (!result.dateFrom || day < result.dateFrom) result.dateFrom = day;
      if (!result.dateTo || day > result.dateTo) result.dateTo = day;
      const id = findContact(inv.customer);
      if (id) matchedCustomers.add(id);
      else newCustomers.add(inv.customer.ico ?? inv.customer.legalName.toLowerCase());
      if (result.preview.length < 10) {
        result.preview.push({ number: inv.invoiceNumber, customer: inv.customer.legalName, issueDate: day, total, currency: inv.currency, status: inv.status });
      }
    }
    result.contactsCreated = newCustomers.size;
    result.contactsMatched = matchedCustomers.size;
    if (dryRun || invoices.length === 0) return result;

    // Highest imported own-format number per (series, year), to continue after.
    const sequences = new Map<string, { series: string; year: number; sequence: number }>();

    // `db` is already the request's transaction (see TenantContextMiddleware), so
    // a failure anywhere rolls the whole import back.
    for (const inv of invoices) {
      let contactId = findContact(inv.customer);
      if (!contactId) {
        const [row] = await db
          .insert(schema.contacts)
          .values({ tenantId, ...inv.customer, ...(inv.customer.dic ? { isVatPayer: true } : {}) })
          .returning({ id: schema.contacts.id });
        contactId = row!.id;
        if (inv.customer.ico) byIco.set(inv.customer.ico, contactId);
        byName.set(inv.customer.legalName.toLowerCase(), contactId);
      }
      const total = totalOf(inv);
      const issuedAt = inv.issueDate;
      // Foreign-currency documents need the CZK rate for VAT and income-tax
      // reports: the source's own rate when it has one, else ČNB on the DUZP.
      const exchangeRate =
        inv.currency === "CZK" ? null : inv.exchangeRate ?? (await getCnbRate(inv.currency, inv.taxableSupplyDate ?? inv.issueDate));
      const [created] = await db
        .insert(schema.invoices)
        .values({
          tenantId,
          contactId,
          invoiceNumber: inv.invoiceNumber,
          variableSymbol: inv.variableSymbol,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate ?? inv.issueDate,
          taxableSupplyDate: inv.taxableSupplyDate,
          currency: inv.currency,
          status: inv.status,
          source: "import",
          documentType: inv.documentType,
          issuedAt,
          sentAt: issuedAt,
          noteBelow: inv.note,
          amountPaid: String(inv.status === "paid" ? total : Math.max(0, Math.min(inv.amountPaid, total))),
          paidAt: inv.paidAt,
          cancelledAt: inv.status === "cancelled" ? issuedAt : null,
          exchangeRate: exchangeRate === null ? null : String(exchangeRate),
          reverseCharge: inv.reverseCharge ?? false,
          ...(inv.paymentMethod ? { paymentMethod: inv.paymentMethod, paymentMethodLabel: inv.paymentMethodLabel ?? null } : {}),
          ...(inv.language ? { language: inv.language } : {}),
        })
        .returning({ id: schema.invoices.id });
      await db.insert(schema.invoiceLineItems).values(
        inv.lines.map((l, i) => ({
          tenantId,
          invoiceId: created!.id,
          description: l.description,
          quantity: String(l.quantity),
          unit: l.unit,
          unitPrice: String(l.unitPrice),
          vatRate: String(l.vatRate),
          sortOrder: i,
        })),
      );
      const own = ownNumberSequence(inv.invoiceNumber);
      if (own) {
        const key = `${own.series}|${own.year}`;
        if ((sequences.get(key)?.sequence ?? 0) < own.sequence) sequences.set(key, own);
      }
    }
    for (const { series, year, sequence } of sequences.values()) {
      await db.execute(sql`
        INSERT INTO invoice_number_sequences (tenant_id, series, year, last_number)
        VALUES (${tenantId}, ${series}, ${year}, ${sequence})
        ON CONFLICT (tenant_id, series, year)
        DO UPDATE SET last_number = GREATEST(invoice_number_sequences.last_number, EXCLUDED.last_number)
      `);
    }
    return result;
  }
}
