import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { decodeCsvBuffer, parseCsv } from "../contacts/contacts-csv.util";
import { highestImportedSequences, mapInvoiceRows, type ImportedContact, type ImportedInvoice, type ImportSkip } from "./invoice-import.util";
import { bumpInvoiceSequences, loadNumberFormats } from "./invoice-numbering.util";
import { computeInvoiceTotal, round2 } from "./invoice-total.util";
import {
  BitfakturaError,
  fetchBitfakturaClients,
  fetchBitfakturaDepartments,
  fetchBitfakturaInvoices,
  fetchBitfakturaPdf,
  mapBitfakturaClients,
  mapBitfakturaInvoices,
  mapBitfakturaSeller,
  type ImportedBusinessDetails,
} from "./bitfaktura-import";import { MAX_ATTACHMENT_BYTES } from "./invoice-attachments.service";
import { getCnbRate } from "../exports/cnb-rates";
import { AuditService } from "../audit/audit.service";
import { buyerSnapshotFromImport } from "./party-snapshot";

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
  /** API imports only: original PDFs stored as archive attachments, and how many could not be fetched. */
  originalPdfs?: { archived: number; missing: number };
  /** API imports only: what the source returned, so the preview can show nothing went missing. */
  source?: { invoices: number; contacts: number };
  /** API imports only: empty business-detail fields filled from the source (or that would be, on a preview). */
  businessFilled?: (keyof ImportedBusinessDetails)[];
  /** API imports only, when the invoices come from more than one supplier IČO: who issued how many. */
  sellers?: ImportSeller[];
  /** API imports only, after a real run: the newest imported invoice shows other supplier details than the profile. */
  sellerUpdate?: SellerProfileUpdate;
}

export interface ImportSeller {
  ico: string;
  name: string | null;
  invoices: number;
}

export interface SellerProfileUpdate {
  invoiceNumber: string;
  issueDate: string;
  changes: { field: "name" | "dic" | "address"; from: string | null; to: string }[];
  /** Ready for `PATCH /tenants/me` (UpdateTenantDto keys); applied only when the owner clicks. */
  patch: Record<string, string | null>;
}

type ProfileRow = {
  ico: string | null;
  companyName: string;
  legalName: string;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
};

/** Supplier IČOs across the source invoices, most invoices first; empty when there is at most one. */
export function distinctSellers(invoices: ImportedInvoice[]): ImportSeller[] {
  const by = new Map<string, ImportSeller>();
  for (const inv of invoices) {
    const ico = inv.sellerSnapshot?.ico;
    if (!ico) continue;
    const entry = by.get(ico) ?? { ico, name: inv.sellerSnapshot?.legalName ?? null, invoices: 0 };
    entry.invoices++;
    by.set(ico, entry);
  }
  return by.size > 1 ? [...by.values()].sort((a, b) => b.invoices - a.invoices || a.ico.localeCompare(b.ico)) : [];
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const oneLine = (...parts: (string | null | undefined)[]) => parts.filter((p) => p && p.trim()).join(", ") || null;

/**
 * What the newest imported invoice says about the supplier that the company
 * profile says differently: name, DIČ, address (as a whole). Null when they
 * agree, or when that invoice is of another IČO (another company, not a move).
 */
export function sellerProfileUpdate(current: ProfileRow, newest: ImportedInvoice | undefined): SellerProfileUpdate | null {
  const snap = newest?.sellerSnapshot;
  if (!newest || !snap) return null;
  if (snap.ico && current.ico && snap.ico !== current.ico) return null;
  const changes: SellerProfileUpdate["changes"] = [];
  const patch: SellerProfileUpdate["patch"] = {};
  const name = snap.legalName?.trim().slice(0, 200);
  if (name && (!same(name, current.legalName) || !same(name, current.companyName))) {
    changes.push({ field: "name", from: current.legalName || null, to: name });
    patch.legal_name = name;
    patch.company_name = name;
  }
  if (snap.dic && /^[A-Z]{2}\d{8,10}$/.test(snap.dic) && snap.dic !== current.dic) {
    changes.push({ field: "dic", from: current.dic, to: snap.dic });
    patch.dic = snap.dic;
  }
  const street = snap.addressStreet?.trim();
  const city = snap.addressCity?.trim();
  const zip = snap.addressPostalCode?.trim() || null;
  const country = snap.addressCountry ?? current.addressCountry;
  if (street && city && !street.includes("@")) {
    const moved = !same(street, current.addressStreet) || !same(city, current.addressCity) || !same(zip, current.addressPostalCode) || country !== current.addressCountry;
    if (moved) {
      changes.push({ field: "address", from: oneLine(current.addressStreet, current.addressPostalCode, current.addressCity), to: oneLine(street, zip, city)! });
      Object.assign(patch, { address_street: street.slice(0, 200), address_city: city.slice(0, 100), address_postal_code: zip?.slice(0, 10) ?? null, address_country: country });
    }
  }
  if (changes.length === 0) return null;
  return { invoiceNumber: newest.invoiceNumber, issueDate: newest.issueDate.toISOString().slice(0, 10), changes, patch };
}

type BusinessRow = { [K in keyof ImportedBusinessDetails]-?: string | null };

/**
 * What the source may fill in the business details: only fields still empty, and the
 * address only as a whole, so a half-typed address is never mixed with another one.
 */
export function businessFill(current: BusinessRow, from: ImportedBusinessDetails | null): ImportedBusinessDetails {
  if (!from) return {};
  const out: ImportedBusinessDetails = {};
  if (from.ico && !current.ico) out.ico = from.ico;
  if (from.dic && !current.dic) out.dic = from.dic;
  if (from.registryNote && !current.registryNote) out.registryNote = from.registryNote;
  if (from.addressStreet && !current.addressStreet && !current.addressCity && !current.addressPostalCode) {
    out.addressStreet = from.addressStreet;
    out.addressCity = from.addressCity;
    if (from.addressPostalCode) out.addressPostalCode = from.addressPostalCode;
    out.addressCountry = from.addressCountry;
  }
  return out;
}

/**
 * A CSV row's buyer as a snapshot: only the columns that are filled, so a
 * column the file lacks falls back to the contact. The country defaults to CZ
 * in the mapper, so it only counts next to an actual address.
 */
export function csvBuyerSnapshot(customer: ImportedInvoice["customer"]) {
  const filled: Partial<ImportedInvoice["customer"]> = Object.fromEntries(
    Object.entries(customer).filter(([, v]) => v !== null && v !== ""),
  );
  if (!filled.addressStreet && !filled.addressCity && !filled.addressPostalCode) delete filled.addressCountry;
  return buyerSnapshotFromImport(filled);
}

/** Parallel PDF downloads; low enough not to hammer the source's API. */
const PDF_CONCURRENCY = 4;

/**
 * "Stěhování": brings the invoice history from another system in as
 * already-issued documents (`source = 'import'`). Nothing is sent, no
 * notifications or webhooks fire, and reminders skip them — they are a
 * record of the past, not new work. Own-format numbers bump the sequence so
 * the next invoice continues the row instead of colliding with it.
 */
@Injectable()
export class InvoiceImportService {
  constructor(@Optional() private readonly audit?: AuditService) {}

  async importCsv(db: TenantDb, tenantId: string, buffer: Buffer, dryRun: boolean): Promise<InvoiceImportResult> {
    let mapped: ReturnType<typeof mapInvoiceRows>;
    try {
      mapped = mapInvoiceRows(parseCsv(decodeCsvBuffer(buffer)));
    } catch {
      throw new BadRequestException({ error: "unknown_columns" });
    }
    const result = await this.importMapped(db, tenantId, mapped, dryRun);
    await this.logImport(db, tenantId, "csv", result);
    return result;
  }

  /**
   * One Historie změn line per import run that brought something in: what
   * came across and which empty business details were filled. Previews and
   * runs that found only duplicates leave no entry.
   */
  private async logImport(
    db: TenantDb,
    tenantId: string,
    source: "csv" | "bitfaktura",
    result: InvoiceImportResult,
    filled: ImportedBusinessDetails = {},
  ) {
    if (result.dryRun) return;
    const filledFields = Object.entries(filled).filter(([, value]) => value);
    if (!result.invoices && !result.contactsCreated && filledFields.length === 0) return;
    const changes: schema.AuditChange[] = [];
    const count = (field: string, n: number | undefined) => {
      if (n) changes.push({ field, from: null, to: n });
    };
    count("importedInvoices", result.invoices);
    count("importedContacts", result.contactsCreated);
    count("archivedPdfs", result.originalPdfs?.archived);
    count("skippedRows", result.skipped?.length);
    for (const [field, value] of filledFields) changes.push({ field, from: null, to: value });
    await this.audit?.record(db, tenantId, { entityType: "import", action: source, changes });
  }

  /** Reads the history over the BitFaktura API with the user's token (used for this request only, never stored). */
  async importFromBitfaktura(
    db: TenantDb,
    tenantId: string,
    account: string,
    apiToken: string,
    dryRun: boolean,
    fetcher?: Parameters<typeof fetchBitfakturaInvoices>[2],
    /** Import only the invoices this supplier IČO issued (an account shared by several businesses). */
    onlySellerIco?: string,
  ): Promise<InvoiceImportResult> {
    let source: Awaited<ReturnType<typeof fetchBitfakturaInvoices>>;
    let clients: Awaited<ReturnType<typeof fetchBitfakturaClients>>;
    try {
      source = await fetchBitfakturaInvoices(account, apiToken, fetcher);
      clients = await fetchBitfakturaClients(account, apiToken, fetcher);
    } catch (error) {
      if (error instanceof BitfakturaError) throw new BadRequestException({ error: error.code });
      throw error;
    }
    // Nice to have: without the seller profile the invoices still come across.
    const seller = mapBitfakturaSeller(await fetchBitfakturaDepartments(account, apiToken, fetcher).catch(() => []));
    const created: { invoice: ImportedInvoice; id: string }[] = [];
    const mapped = mapBitfakturaInvoices(source);
    // Several suppliers in one account: say so, and import one of them only on request.
    // Companies are never created from this; the user picks which one this is.
    const sellers = distinctSellers(mapped.invoices);
    if (onlySellerIco) {
      const own = mapped.invoices.filter((inv) => inv.sellerSnapshot?.ico === onlySellerIco);
      const other = mapped.invoices.filter((inv) => inv.sellerSnapshot?.ico !== onlySellerIco);
      mapped.invoices = own;
      mapped.skipped.push(...other.map((inv) => ({ line: inv.line, number: inv.invoiceNumber, reason: "other_seller" as const })));
    }
    const result = await this.importMapped(
      db,
      tenantId,
      mapped,
      dryRun,
      (invoice, id) => created.push({ invoice, id }),
      mapBitfakturaClients(clients),
    );
    result.source = { invoices: source.length, contacts: clients.length };
    if (sellers.length > 0) result.sellers = sellers;
    const [tenant] = await db
      .select({
        companyName: schema.tenants.companyName,
        legalName: schema.tenants.legalName,
        ico: schema.tenants.ico,
        dic: schema.tenants.dic,
        registryNote: schema.tenants.registryNote,
        addressStreet: schema.tenants.addressStreet,
        addressCity: schema.tenants.addressCity,
        addressPostalCode: schema.tenants.addressPostalCode,
        addressCountry: schema.tenants.addressCountry,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const fill = tenant ? businessFill(tenant, seller) : {};
    result.businessFilled = Object.keys(fill) as (keyof ImportedBusinessDetails)[];
    if (dryRun) return result;
    if (result.businessFilled.length > 0) {
      await db
        .update(schema.tenants)
        .set({ ...fill, updatedAt: new Date() })
        .where(eq(schema.tenants.id, tenantId));
    }

    // Archive copy of what the customer received. Not e-mailed again and not
    // shown in the portal; the invoice data itself stays as imported.
    const originalPdfs = { archived: 0, missing: 0 };
    const queue = [...created];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const pdf = next.invoice.sourceId
          ? await fetchBitfakturaPdf(account, apiToken, next.invoice.sourceId, MAX_ATTACHMENT_BYTES, fetcher)
          : null;
        if (!pdf) {
          originalPdfs.missing++;
          continue;
        }
        await db.insert(schema.invoiceAttachments).values({
          tenantId,
          invoiceId: next.id,
          filename: `${next.invoice.invoiceNumber.replace(/[\\/:*?"<>|]/g, "-")}-bitfaktura.pdf`,
          mime: "application/pdf",
          sizeBytes: pdf.length,
          data: pdf.toString("base64"),
          sendWithEmail: false,
          showInPortal: false,
        });
        originalPdfs.archived++;
      }
    };
    await Promise.all(Array.from({ length: PDF_CONCURRENCY }, worker));
    const done: InvoiceImportResult = { ...result, originalPdfs };
    // Compared with the profile as it stands after the fill above.
    const newest = created.reduce<ImportedInvoice | undefined>((a, { invoice }) => (!a || invoice.issueDate >= a.issueDate ? invoice : a), undefined);
    const update = tenant ? sellerProfileUpdate({ ...tenant, ...fill }, newest) : null;
    if (update) done.sellerUpdate = update;
    await this.logImport(db, tenantId, "bitfaktura", done, fill);
    return done;
  }

  private async importMapped(
    db: TenantDb,
    tenantId: string,
    mapped: { invoices: ImportedInvoice[]; skipped: ImportSkip[] },
    dryRun: boolean,
    onCreated?: (invoice: ImportedInvoice, id: string) => void,
    /** Contacts from the source's address book, also those never invoiced. */
    contacts: ImportedContact[] = [],
  ): Promise<InvoiceImportResult> {
    if (mapped.invoices.length > MAX_IMPORT_INVOICES || contacts.length > MAX_IMPORT_INVOICES) throw new BadRequestException({ error: "too_many_rows" });

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
    // Names the import will create: a buyer found by name in the address book counts once,
    // the same way the write below finds it. (One IČO is already one key in newCustomers.)
    const pendingName = new Set<string>();
    const count = (c: ImportedInvoice["customer"]) => {
      const id = findContact(c);
      if (id) return matchedCustomers.add(id);
      if (pendingName.has(c.legalName.toLowerCase())) return;
      newCustomers.add(c.ico ?? c.legalName.toLowerCase());
      pendingName.add(c.legalName.toLowerCase());
    };
    contacts.forEach(count);
    for (const inv of invoices) {
      const total = totalOf(inv);
      result.byStatus[inv.status]++;
      if (inv.status !== "cancelled") result.totals[inv.currency] = round2((result.totals[inv.currency] ?? 0) + total);
      const day = inv.issueDate.toISOString().slice(0, 10);
      if (!result.dateFrom || day < result.dateFrom) result.dateFrom = day;
      if (!result.dateTo || day > result.dateTo) result.dateTo = day;
      count(inv.customer);
      if (result.preview.length < 10) {
        result.preview.push({ number: inv.invoiceNumber, customer: inv.customer.legalName, issueDate: day, total, currency: inv.currency, status: inv.status });
      }
    }
    result.contactsCreated = newCustomers.size;
    result.contactsMatched = matchedCustomers.size;
    if (dryRun || (invoices.length === 0 && newCustomers.size === 0)) return result;

    const createContact = async (c: ImportedContact) => {
      const [row] = await db
        .insert(schema.contacts)
        .values({ tenantId, ...c, ...(c.dic ? { isVatPayer: true } : {}) })
        .returning({ id: schema.contacts.id });
      if (c.ico) byIco.set(c.ico, row!.id);
      byName.set(c.legalName.toLowerCase(), row!.id);
      return row!.id;
    };

    // `db` is already the request's transaction (see TenantContextMiddleware), so
    // a failure anywhere rolls the whole import back.
    for (const c of contacts) {
      if (!findContact(c)) await createContact(c);
    }
    for (const inv of invoices) {
      const contactId = findContact(inv.customer) ?? (await createContact(inv.customer));
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
          ...(inv.exchangeRate != null && inv.exchangeRateMode
            ? { exchangeRateMode: inv.exchangeRateMode, exchangeRateDate: inv.exchangeRateDate ?? null }
            : {}),
          internalNote: inv.internalNote ?? null,
          orderNumber: inv.orderNumber ?? null,
          issuePlace: inv.issuePlace ?? null,
          issuedByName: inv.issuedByName ?? null,
          reverseCharge: inv.reverseCharge ?? false,
          ...(inv.paymentMethod ? { paymentMethod: inv.paymentMethod, paymentMethodLabel: inv.paymentMethodLabel ?? null } : {}),
          ...(inv.language ? { language: inv.language } : {}),
          // The parties as the source document shows them, not as the matched
          // contact / today's company details say. CSV: the filled customer
          // columns only; no supplier columns, so no supplier snapshot.
          sellerSnapshot: inv.sellerSnapshot ?? null,
          buyerSnapshot:
            inv.buyerSnapshot !== undefined
              ? inv.buyerSnapshot
              : csvBuyerSnapshot(inv.customer),
        })
        .returning({ id: schema.invoices.id });
      onCreated?.(inv, created!.id);
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
    }
    if (invoices.length === 0) return result;
    // Continue numbering after the highest imported number per counter, read
    // with the company's own pattern (e.g. `N/MM/YYYY`) or our built-in format.
    await bumpInvoiceSequences(db, tenantId, highestImportedSequences(invoices, await loadNumberFormats(db, tenantId)));
    return result;
  }
}
