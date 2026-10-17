import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  checkInvoiceRequirements,
  generateIsdocXml,
  generateUblInvoiceXml,
  validatePeppolInvoice,
  type PeppolIssue,
  type RequirementIssue,
} from "@faktur/cz-compliance";
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { fuzzyScore } from "../common/fuzzy";
import { getCnbDay } from "../exports/cnb-rates";
import { exchangeRateSettingsOf, isCnbRate, resolveRateMode, type StoredRateMode } from "./exchange-rate-mode";
import * as schema from "../../drizzle/schema";
import { EmailService, type EmailAttachment, type EmailCustomization } from "../email/email.service";
import { emailCustomizationOf, emailPrefsOf } from "../tenants/email-prefs";
import { templateValues, templateVarsOf } from "../tenants/template-vars";
import { InvoiceAttachmentsService } from "./invoice-attachments.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuditService } from "../audit/audit.service";
import type { NotificationEvent } from "../notifications/notification-prefs";
import type { CreateInvoiceDto, ListInvoicesQuery, UpdateInvoiceDto } from "./dto/create-invoice.dto";
import type { CreateInvoiceDraftDto } from "./dto/create-invoice-draft.dto";
import { InvoicePdfService } from "./invoice-pdf.service";
import {
  allocateInvoiceNumber,
  loadNumberFormats,
  variableSymbolFor,
} from "./invoice-numbering.util";
import { computeInvoiceTotal, computeVatBreakdown, formatInvoiceAmount, lineBase, round2 } from "./invoice-total.util";
import { documentVars } from "./custom-fields";
import { resolveTenantForInvoice } from "../tenants/bank-accounts";
import {
  BUYER_SNAPSHOT_KEYS,
  SELLER_SNAPSHOT_KEYS,
  applyBuyerSnapshot,
  buyerSnapshotOf,
  documentParties,
  sellerSnapshotOf,
  snapshotDiffers,
} from "./party-snapshot";
import { buildIsdocInvoiceInput, contactToIsdocParty, tenantToIsdocParty } from "./isdoc-input.builder";
import { assertCanSendEmail, recordEmailSent } from "../abuse/sending-guard";

// TODO: once packages/cz-compliance is ready, ARES-resolve
// counterparty_ico / counterparty_name_raw into a real `contacts` row here
// instead of leaving contactId null on drafts:
// import { lookupIco } from "@faktur/cz-compliance";

type TenantDb = PostgresJsDatabase<typeof schema>;
type InvoiceRow = typeof schema.invoices.$inferSelect;

type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;
type LineItemInput = NonNullable<UpdateInvoiceDto["line_items"]>[number];

const ISSUABLE_STATUSES: ReadonlyArray<InvoiceRow["status"]> = ["draft", "pending_review"];

/** Document number prefixes printed into the notes of a derived document. */
const DOCUMENT_LABEL_CS: Record<InvoiceRow["documentType"], string> = {
  invoice: "faktury",
  proforma: "zálohové faktury",
  credit_note: "opravného daňového dokladu",
  quote: "cenové nabídky",
};

function lineItemValues(tenantId: string, invoiceId: string, items: LineItemInput[]) {
  return items.map((item, index) => ({
    tenantId,
    invoiceId,
    description: item.description,
    quantity: item.quantity.toString(),
    unit: item.unit || null,
    code: item.code || null,
    unitPrice: item.unit_price.toString(),
    vatRate: item.vat_rate != null ? item.vat_rate.toString() : null,
    discountPercent: (item.discount_percent ?? 0).toString(),
    sortOrder: index,
  }));
}

/** The person-editable columns of a draft, from a (partial) DTO. */
function invoiceFieldValues(dto: UpdateInvoiceDto) {
  const v: Partial<typeof schema.invoices.$inferInsert> = {};
  if (dto.document_type !== undefined) v.documentType = dto.document_type;
  if (dto.related_invoice_id !== undefined) v.relatedInvoiceId = dto.related_invoice_id ?? null;
  if (dto.contact_id !== undefined) v.contactId = dto.contact_id ?? null;
  if (dto.issue_date !== undefined) v.issueDate = dto.issue_date;
  if (dto.due_date !== undefined) v.dueDate = dto.due_date ?? null;
  if (dto.taxable_supply_date !== undefined) v.taxableSupplyDate = dto.taxable_supply_date ?? null;
  if (dto.currency !== undefined) v.currency = dto.currency.toUpperCase();
  if (dto.bank_account_id !== undefined) v.bankAccountId = dto.bank_account_id ?? null;
  if (dto.exchange_rate !== undefined) v.exchangeRate = dto.exchange_rate == null ? null : dto.exchange_rate.toFixed(6);
  if (dto.payment_method !== undefined) v.paymentMethod = dto.payment_method;
  if (dto.payment_method_label !== undefined) v.paymentMethodLabel = dto.payment_method_label || null;
  if (dto.payment_instructions !== undefined) v.paymentInstructions = dto.payment_instructions || null;
  if (dto.variable_symbol !== undefined) v.variableSymbol = dto.variable_symbol || null;
  if (dto.constant_symbol !== undefined) v.constantSymbol = dto.constant_symbol || null;
  if (dto.specific_symbol !== undefined) v.specificSymbol = dto.specific_symbol || null;
  if (dto.order_number !== undefined) v.orderNumber = dto.order_number || null;
  if (dto.note_above !== undefined) v.noteAbove = dto.note_above || null;
  if (dto.note_below !== undefined) v.noteBelow = dto.note_below || null;
  if (dto.internal_note !== undefined) v.internalNote = dto.internal_note || null;
  if (dto.issue_place !== undefined) v.issuePlace = dto.issue_place || null;
  if (dto.issued_by_name !== undefined) v.issuedByName = dto.issued_by_name || null;
  if (dto.custom_fields !== undefined) v.customFields = dto.custom_fields;
  if (dto.amount_paid !== undefined) v.amountPaid = (dto.amount_paid ?? 0).toFixed(2);
  if (dto.language !== undefined) v.language = dto.language;
  if (dto.reverse_charge !== undefined) v.reverseCharge = dto.reverse_charge;
  return v;
}

/**
 * Whether a document may be in this state without a customer: a draft may
 * (the customer can still be picked, or fill in their own details through
 * the "Poslat odběrateli k doplnění údajů" link), an issued document never.
 * Returns the error to show, or null when it is fine.
 */
export function customerRequiredError(action: "save_draft" | "issue" | "edit_issued", contactId: string | null | undefined): string | null {
  if (contactId) return null;
  if (action === "save_draft") return null;
  return action === "issue" ? "Invoice has no contact – assign one before issuing" : "An issued document must keep its customer";
}

/**
 * Edit-with-reason of an issued document: a different rate than the stored
 * one makes it `manual` (no "Kurz ČNB k …" claim for a rate that is not
 * ČNB's). A hidden conversion stays hidden, an untouched rate stays as it was.
 */
export function rateModeAfterEdit(
  invoice: Pick<InvoiceRow, "exchangeRate" | "exchangeRateMode">,
  values: Partial<typeof schema.invoices.$inferInsert>,
): Partial<typeof schema.invoices.$inferInsert> {
  if (values.exchangeRate === undefined) return {};
  const before = invoice.exchangeRate == null ? null : Number(invoice.exchangeRate);
  const after = values.exchangeRate == null ? null : Number(values.exchangeRate);
  if (before === after || after == null || invoice.exchangeRateMode === "none") return {};
  return { exchangeRateMode: "manual", exchangeRateDate: null };
}

/**
 * `rateModeAfterEdit`, except that a new rate equal to ČNB's for the
 * document's day (the "Načíst z ČNB" button) is stored as the ČNB rate with
 * its list day instead of as a plain typed rate.
 */
export async function rateAfterEdit(
  invoice: Pick<InvoiceRow, "currency" | "exchangeRate" | "exchangeRateMode" | "taxableSupplyDate" | "issueDate">,
  values: Partial<typeof schema.invoices.$inferInsert>,
): Promise<Partial<typeof schema.invoices.$inferInsert>> {
  const change = rateModeAfterEdit(invoice, values);
  if (change.exchangeRateMode !== "manual" || values.exchangeRate == null) return change;
  const currency = (values.currency ?? invoice.currency).toUpperCase();
  const supply = values.taxableSupplyDate !== undefined ? values.taxableSupplyDate : invoice.taxableSupplyDate;
  const day = supply ?? values.issueDate ?? invoice.issueDate;
  if (currency === "CZK" || !day) return change;
  const cnb = await getCnbDay(new Date(day));
  const cnbRate = cnb?.rates.get(currency)?.rate ?? null;
  if (!isCnbRate(Number(values.exchangeRate), cnbRate)) return change;
  return { exchangeRate: cnbRate!.toFixed(6), exchangeRateMode: "cnb_daily", exchangeRateDate: cnb!.date };
}

/** Per-field audit entries ("seller.dic: CZ1 → CZ2") between two party snapshots. */
function snapshotChanges(prefix: string, from: unknown, to: unknown, keys: readonly string[]) {
  const a = (from ?? {}) as Record<string, unknown>;
  const b = (to ?? {}) as Record<string, unknown>;
  return keys
    .filter((k) => (a[k] ?? null) !== (b[k] ?? null))
    .map((k) => ({ field: `${prefix}.${k}`, from: a[k] ?? null, to: b[k] ?? null }));
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "overdue" is not stored: an issued invoice whose due date has passed. */
export function isOverdue(invoice: Pick<InvoiceRow, "status" | "dueDate" | "documentType">): boolean {
  return (
    invoice.status === "issued" &&
    invoice.documentType !== "quote" &&
    invoice.dueDate != null &&
    new Date(invoice.dueDate) < startOfToday()
  );
}

/** Maps the AI microservice's bare channel identifier to this backend's
 * `invoice_source` enum value. See the long comment in
 * `dto/create-invoice-draft.dto.ts` for why these two vocabularies differ. */
function toInvoiceSource(channel: "telegram" | "whatsapp"): "ai_telegram" | "ai_whatsapp" {
  return channel === "telegram" ? "ai_telegram" : "ai_whatsapp";
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly emailService: EmailService,
    private readonly invoicePdfService: InvoicePdfService,
    @Optional() private readonly attachmentsService?: InvoiceAttachmentsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** One line in the document's history (Settings → Historie změn). */
  private async log(
    db: TenantDb,
    invoice: Pick<InvoiceRow, "id" | "tenantId" | "invoiceNumber" | "documentType">,
    action: string,
    changes?: { field: string; from: unknown; to: unknown }[],
    reason?: string | null,
  ) {
    await this.audit?.record(db, invoice.tenantId, {
      entityType: "invoice",
      entityId: invoice.id,
      // The number only; the UI adds the translated document type.
      entityLabel: invoice.invoiceNumber ?? null,
      action,
      changes,
      reason,
    });
  }

  /** Settings → Notifikace for one invoice event (fire-and-forget). */
  private ping(invoice: typeof schema.invoices.$inferSelect, kind: NotificationEvent, title: string, body?: string) {
    this.notifications?.notify(invoice.tenantId, kind, { title, body, link: `/invoices/${invoice.id}` });
  }

  /**
   * Settings → E-maily applied to one outgoing email: the company's subject,
   * text, sender name, reply-to, and — for the invoice email — the PDF,
   * ISDOC and the invoice's own attachments marked "send with email".
   */
  private async emailCustomization(
    db: TenantDb,
    tenantId: string,
    invoice: typeof schema.invoices.$inferSelect,
    contact: typeof schema.contacts.$inferSelect,
    kind: "invoice" | "reminder",
  ): Promise<EmailCustomization> {
    const [liveTenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    const prefs = emailPrefsOf(liveTenant?.emailPrefs);
    const attachments: EmailAttachment[] = [];
    if (kind === "invoice" && invoice.invoiceNumber) {
      const base = `faktura-${invoice.invoiceNumber.replace(/[^\w.-]+/g, "_")}`;
      if (prefs.attachPdf) {
        attachments.push({ filename: `${base}.pdf`, content: await this.generateInvoicePdf(db, tenantId, invoice.id), contentType: "application/pdf" });
      }
      if (prefs.attachIsdoc) {
        const xml = await this.generateInvoiceIsdoc(db, tenantId, invoice.id);
        attachments.push({ filename: `${base}.isdoc`, content: Buffer.from(xml, "utf8"), contentType: "application/xml" });
      }
    }
    if (kind === "invoice" && this.attachmentsService) {
      attachments.push(...(await this.attachmentsService.forEmail(db, invoice.id)));
    }
    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoice.id));
    const breakdown = computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge });
    // {company}, {ico}, {iban}, {customer}… as on the document (its snapshot, if issued).
    const tenant = liveTenant ? documentParties(invoice, await resolveTenantForInvoice(db, liveTenant, invoice), contact).tenant : undefined;
    const buyer = applyBuyerSnapshot(contact, invoice.buyerSnapshot);
    const vars = {
      ...templateValues(tenant, invoice, buyer),
      ...documentVars(invoice.customFields, breakdown, invoice.amountPaid, templateVarsOf(liveTenant?.templateVars), (n) => formatInvoiceAmount(n, invoice.currency)).formatted,
    };
    // Sender name and reply-to stay the company's current ones.
    return { ...emailCustomizationOf(prefs, kind, liveTenant, buyer.legalName, vars), attachments };
  }

  /**
   * The invoice list: every invoice column plus the customer's name and the
   * computed totals, so the dashboard and API clients never have to fetch
   * line items row by row. RLS restricts all of it to the current tenant.
   */
  async list(db: TenantDb, query: ListInvoicesQuery = {}) {
    const conditions = [];
    if (query.type) conditions.push(eq(schema.invoices.documentType, query.type));
    if (query.contact_id) conditions.push(eq(schema.invoices.contactId, query.contact_id));
    if (query.contact_color) conditions.push(eq(schema.contacts.color, query.contact_color));
    if (query.status === "overdue") {
      conditions.push(eq(schema.invoices.status, "issued"), lt(schema.invoices.dueDate, startOfToday()));
    } else if (query.status) {
      conditions.push(eq(schema.invoices.status, query.status));
    }
    if (query.payment_method) conditions.push(eq(schema.invoices.paymentMethod, query.payment_method));
    if (query.currency) conditions.push(eq(schema.invoices.currency, query.currency));
    if (query.sent === "no") conditions.push(isNull(schema.invoices.sentAt));
    if (query.sent === "yes") conditions.push(isNotNull(schema.invoices.sentAt));
    if (query.viewed === "no") conditions.push(eq(schema.invoices.publicViewCount, 0));
    if (query.viewed === "yes") conditions.push(gt(schema.invoices.publicViewCount, 0));
    if (query.from || query.to) {
      const column = {
        issue: schema.invoices.issueDate,
        due: schema.invoices.dueDate,
        paid: schema.invoices.paidAt,
        taxable: schema.invoices.taxableSupplyDate,
        sent: schema.invoices.sentAt,
        created: schema.invoices.createdAt,
      }[query.date_field ?? "issue"];
      if (query.from) conditions.push(gte(column, new Date(`${query.from}T00:00:00Z`)));
      // `to` is inclusive: everything before the start of the next day.
      if (query.to) conditions.push(lt(column, new Date(Date.parse(`${query.to}T00:00:00Z`) + 86_400_000)));
    }

    if (query.source === "ai") conditions.push(inArray(schema.invoices.source, ["ai_telegram", "ai_whatsapp"]));
    else if (query.source) conditions.push(eq(schema.invoices.source, query.source));
    if (query.language) conditions.push(eq(schema.invoices.language, query.language));
    if (query.reverse_charge) conditions.push(eq(schema.invoices.reverseCharge, query.reverse_charge === "yes"));
    if (query.paid_state === "full") conditions.push(eq(schema.invoices.status, "paid"));
    if (query.paid_state === "unpaid") conditions.push(eq(schema.invoices.amountPaid, "0"), inArray(schema.invoices.status, ["issued", "draft", "pending_review"]));
    if (query.paid_state === "partial") conditions.push(gt(schema.invoices.amountPaid, "0"), eq(schema.invoices.status, "issued"));
    if (query.overdue_days) {
      conditions.push(
        eq(schema.invoices.status, "issued"),
        lt(schema.invoices.dueDate, new Date(startOfToday().getTime() - (query.overdue_days - 1) * 86_400_000)),
      );
    }
    if (query.reminded === "yes") conditions.push(gt(schema.invoices.reminderCount, 0));
    if (query.reminded === "no") conditions.push(eq(schema.invoices.reminderCount, 0));
    if (query.internal_note === "yes") conditions.push(sql`coalesce(trim(${schema.invoices.internalNote}), '') <> ''`);
    if (query.internal_note === "no") conditions.push(sql`coalesce(trim(${schema.invoices.internalNote}), '') = ''`);
    if (query.client_response === "none") conditions.push(isNull(schema.invoices.clientResponse));
    else if (query.client_response) conditions.push(eq(schema.invoices.clientResponse, query.client_response));
    if (query.bank_account_id) conditions.push(eq(schema.invoices.bankAccountId, query.bank_account_id));
    if (query.attachments) {
      const has = sql`exists (select 1 from ${schema.invoiceAttachments} where ${schema.invoiceAttachments.invoiceId} = ${schema.invoices.id})`;
      conditions.push(query.attachments === "yes" ? has : sql`not ${has}`);
    }

    if (query.symbol) {
      const like = `%${query.symbol}%`;
      conditions.push(
        or(
          ilike(schema.invoices.variableSymbol, like),
          ilike(schema.invoices.constantSymbol, like),
          ilike(schema.invoices.specificSymbol, like),
        )!,
      );
    }
    if (query.order_number) conditions.push(ilike(schema.invoices.orderNumber, `%${query.order_number}%`));
    if (query.issued_by) conditions.push(eq(schema.invoices.issuedByUserId, query.issued_by));
    if (query.country === "foreign") conditions.push(notInArray(schema.contacts.addressCountry, ["CZ", "SK"]));
    else if (query.country) conditions.push(eq(schema.contacts.addressCountry, query.country));
    if (query.needs_attention) conditions.push(eq(schema.invoices.needsAttention, query.needs_attention === "yes"));
    if (query.has_custom_fields === "yes") conditions.push(sql`jsonb_array_length(${schema.invoices.customFields}) > 0`);
    if (query.has_custom_fields === "no") conditions.push(sql`jsonb_array_length(${schema.invoices.customFields}) = 0`);
    if (query.related) {
      const linked = sql`(${schema.invoices.relatedInvoiceId} is not null or exists (select 1 from invoices r where r.related_invoice_id = ${schema.invoices.id}))`;
      conditions.push(query.related === "yes" ? linked : sql`not ${linked}`);
    }

    const allRows = await db
      .select({ invoice: schema.invoices, contactName: schema.contacts.legalName, contactIco: schema.contacts.ico, contactColor: schema.contacts.color })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.invoices.createdAt));
    // Text search runs here rather than in SQL so it can ignore accents and
    // forgive a typo ("novak" finds "Novák", "fakturka" finds "Faktůrka").
    const q = query.q?.trim();
    const note = query.note?.trim();
    const customField = query.custom_field?.trim();
    const rows = allRows.filter(
      (r) =>
        (!q || fuzzyScore(q, [r.invoice.invoiceNumber, r.contactName, r.contactIco, r.invoice.variableSymbol, r.invoice.orderNumber]) > 0) &&
        (!note ||
          fuzzyScore(note, [r.invoice.internalNote, r.invoice.noteAbove, r.invoice.noteBelow, r.invoice.clientResponseNote]) > 0) &&
        (!customField || fuzzyScore(customField, (r.invoice.customFields ?? []).flatMap((f) => [f.label, f.value])) > 0),
    );

    const ids = rows.map((r) => r.invoice.id);
    const items = ids.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids))
      : [];
    const itemsByInvoice = new Map<string, LineItemRow[]>();
    for (const item of items) {
      const list = itemsByInvoice.get(item.invoiceId) ?? [];
      list.push(item);
      itemsByInvoice.set(item.invoiceId, list);
    }

    // Line-item filters: a VAT rate or a text in any item of the document.
    const item = query.item?.trim();
    const itemRows =
      query.vat_rate === undefined && !item
        ? rows
        : rows.filter((r) => {
            const lines = itemsByInvoice.get(r.invoice.id) ?? [];
            return (
              (query.vat_rate === undefined || lines.some((l) => l.vatRate !== null && Number(l.vatRate) === query.vat_rate)) &&
              (!item || lines.some((l) => fuzzyScore(item, [l.description, l.code]) > 0))
            );
          });

    const list = itemRows.map(({ invoice, contactName, contactIco, contactColor }) => {
      const totals = computeVatBreakdown(itemsByInvoice.get(invoice.id) ?? [], {
        reverseCharge: invoice.reverseCharge,
      });
      return {
        ...invoice,
        contactName,
        contactIco,
        contactColor,
        totalWithoutVat: totals.totalWithoutVat,
        totalVat: totals.totalVat,
        total: totals.totalWithVat,
        isOverdue: isOverdue(invoice),
      };
    });
    // Totals come from the line items, so the amount range applies here.
    const { amount_min: min, amount_max: max, net_min: netMin, net_max: netMax, due_min: dueMin } = query;
    const within = (value: number, lo?: number, hi?: number) => (lo === undefined || value >= lo) && (hi === undefined || value <= hi);
    return list.filter(
      (r) =>
        within(Number(r.total), min, max) &&
        within(Number(r.totalWithoutVat), netMin, netMax) &&
        (dueMin === undefined ||
          (["issued", "draft", "pending_review"].includes(r.status) && Number(r.total) - Number(r.amountPaid) >= dueMin)),
    );
  }

  private async requireContact(db: TenantDb, contactId: string) {
    const [contact] = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, contactId))
      .limit(1);
    if (!contact) throw new NotFoundException("Contact not found");
    return contact;
  }

  private async requireInvoice(db: TenantDb, id: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    return invoice;
  }

  /** A credit note must point at an issued invoice of this tenant. */
  private async checkRelated(db: TenantDb, documentType: InvoiceRow["documentType"], relatedId?: string | null) {
    if (documentType === "credit_note" && !relatedId) {
      throw new BadRequestException("A credit note must reference the invoice it corrects (related_invoice_id)");
    }
    if (!relatedId) return null;
    const related = await this.requireInvoice(db, relatedId);
    if (documentType === "credit_note" && (related.documentType !== "invoice" || !related.invoiceNumber)) {
      throw new BadRequestException("A credit note can only correct an issued invoice");
    }
    return related;
  }

  /**
   * A person-typed draft from the dashboard form or the public API. The
   * contact must belong to this tenant — RLS hides other tenants' contacts,
   * so a foreign id simply isn't found. A draft may have no contact yet
   * (`customerRequiredError`); issuing it still needs one.
   */
  async create(db: TenantDb, tenantId: string, dto: CreateInvoiceDto, source: "manual" | "api" = "manual") {
    const missing = customerRequiredError("save_draft", dto.contact_id);
    if (missing) throw new BadRequestException(missing);
    if (dto.contact_id) await this.requireContact(db, dto.contact_id);
    await this.checkRelated(db, dto.document_type, dto.related_invoice_id);

    // No db.transaction here: `db` is the request's own transaction (tenant
    // context is SET LOCAL inside it), so the inserts are already atomic.
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        ...invoiceFieldValues(dto),
        tenantId,
        contactId: dto.contact_id ?? null,
        issueDate: dto.issue_date ?? new Date(),
        status: "draft",
        source,
        rawAiPayload: dto.source_ai ? { prefilledByAi: true } : null,
      })
      .returning();

    await db.insert(schema.invoiceLineItems).values(lineItemValues(tenantId, invoice.id, dto.line_items));

    if (dto.template_id) {
      await db
        .update(schema.invoiceTemplates)
        .set({ usageCount: sql`${schema.invoiceTemplates.usageCount} + 1`, lastUsedAt: new Date() })
        .where(eq(schema.invoiceTemplates.id, dto.template_id));
    }
    await this.log(db, invoice, "created");
    return invoice;
  }

  /**
   * Edit a draft — or, with `edit_reason`, an issued or paid document
   * ("Přesto upravit"): the number stays, every changed field goes to the
   * audit log together with the reason. The usual way to correct an issued
   * invoice is still a credit note; this is for typos and similar.
   */
  async update(db: TenantDb, tenantId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.requireInvoice(db, id);
    const reason = dto.edit_reason?.trim() || null;
    const issued = !ISSUABLE_STATUSES.includes(invoice.status);
    if (issued) {
      if (invoice.status === "cancelled") throw new BadRequestException("A cancelled document cannot be edited");
      if (!reason) {
        throw new BadRequestException("An issued document can only be edited with a reason (edit_reason)");
      }
      if (dto.document_type !== undefined && dto.document_type !== invoice.documentType) {
        throw new BadRequestException("The type of an issued document cannot be changed");
      }
      if (dto.related_invoice_id !== undefined && (dto.related_invoice_id ?? null) !== invoice.relatedInvoiceId) {
        throw new BadRequestException("The linked document of an issued document cannot be changed");
      }
      if (dto.contact_id !== undefined) {
        const missing = customerRequiredError("edit_issued", dto.contact_id);
        if (missing) throw new BadRequestException(missing);
      }
    }
    if (dto.contact_id) await this.requireContact(db, dto.contact_id);
    const documentType = dto.document_type ?? invoice.documentType;
    const relatedId = dto.related_invoice_id !== undefined ? dto.related_invoice_id : invoice.relatedInvoiceId;
    await this.checkRelated(db, documentType, relatedId);

    const values = invoiceFieldValues(dto);
    // A rate changed by hand on an issued document is no longer the ČNB or
    // annual rate it was printed as; label it as a plain rate from now on.
    if (issued) Object.assign(values, await rateAfterEdit(invoice, values));
    const changes = this.audit?.diff(invoice as Record<string, unknown>, values as Record<string, unknown>) ?? [];
    if (issued) changes.push(...(await this.snapshotAfterEdit(db, tenantId, invoice, values)));

    if (dto.line_items) {
      const oldItems = await db
        .select()
        .from(schema.invoiceLineItems)
        .where(eq(schema.invoiceLineItems.invoiceId, id))
        .orderBy(asc(schema.invoiceLineItems.sortOrder));
      const newItems = lineItemValues(tenantId, id, dto.line_items);
      const describe = (rows: { description: string; quantity: string | number; unit?: string | null; unitPrice: string | number }[]) =>
        rows.map((r) => `${r.description} — ${Number(r.quantity)}${r.unit ? ` ${r.unit}` : ""} × ${Number(r.unitPrice)}`);
      const fromItems = describe(oldItems);
      const toItems = describe(newItems);
      if (JSON.stringify(fromItems) !== JSON.stringify(toItems)) changes.push({ field: "lineItems", from: fromItems, to: toItems });
      const oldTotal = round2(computeInvoiceTotal(oldItems, { reverseCharge: invoice.reverseCharge }));
      const newTotal = round2(
        computeInvoiceTotal(newItems as unknown as typeof oldItems, { reverseCharge: values.reverseCharge ?? invoice.reverseCharge }),
      );
      if (oldTotal !== newTotal) {
        changes.push({ field: "total", from: oldTotal, to: newTotal });
        // A paid document stays paid in full at its new total.
        if (invoice.status === "paid") values.amountPaid = newTotal.toFixed(2);
      }
      await db.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id));
      await db.insert(schema.invoiceLineItems).values(newItems);
    }

    const [updated] = await db
      .update(schema.invoices)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();

    if (changes.length > 0 || reason) await this.log(db, updated, issued ? "edited_issued" : "updated", changes, reason);
    return updated;
  }

  /**
   * Editing an issued document never refreshes its snapshot from today's
   * details on its own. Only what the edit itself changes is re-taken: a
   * different customer chosen, or a different payment account / currency.
   * Documents without a snapshot (issued before it existed) stay without one.
   */
  private async snapshotAfterEdit(
    db: TenantDb,
    tenantId: string,
    invoice: InvoiceRow,
    values: Partial<typeof schema.invoices.$inferInsert>,
  ) {
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    const contactId = values.contactId !== undefined ? values.contactId : invoice.contactId;
    if (invoice.buyerSnapshot && contactId !== invoice.contactId) {
      const [contact] = contactId ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).limit(1) : [];
      values.buyerSnapshot = contact ? buyerSnapshotOf(contact) : null;
      changes.push(...snapshotChanges("buyer", invoice.buyerSnapshot, values.buyerSnapshot, BUYER_SNAPSHOT_KEYS));
    }
    const bankAccountId = values.bankAccountId !== undefined ? values.bankAccountId : invoice.bankAccountId;
    const currency = values.currency ?? invoice.currency;
    if (invoice.sellerSnapshot && (bankAccountId !== invoice.bankAccountId || currency !== invoice.currency)) {
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
      if (tenant) {
        const payee = await resolveTenantForInvoice(db, tenant, { bankAccountId: bankAccountId ?? null, currency });
        const bank = {
          bankAccountNumber: payee.bankAccountNumber,
          bankAccountBankCode: payee.bankAccountBankCode,
          bankAccountIban: payee.bankAccountIban,
          bankAccountSwift: payee.bankAccountSwift,
        };
        values.sellerSnapshot = { ...(invoice.sellerSnapshot as Record<string, unknown>), ...bank };
        changes.push(...snapshotChanges("seller", invoice.sellerSnapshot, values.sellerSnapshot, Object.keys(bank)));
      }
    }
    return changes;
  }

  /** Delete a draft that never got a number. */
  async remove(db: TenantDb, id: string) {
    const invoice = await this.requireInvoice(db, id);
    if (!ISSUABLE_STATUSES.includes(invoice.status) || invoice.invoiceNumber) {
      throw new BadRequestException("Only an unissued draft can be deleted — cancel an issued document instead");
    }
    const [child] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.relatedInvoiceId, id))
      .limit(1);
    if (child) throw new BadRequestException("Another document refers to this draft");
    await db.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id));
    await db.delete(schema.invoices).where(eq(schema.invoices.id, id));
    await this.log(db, invoice, "deleted");
    return { deleted: true };
  }

  /**
   * Everything the invoice detail page shows: the invoice, its customer,
   * line items with per-line totals, the VAT recapitulation, and the
   * documents linked to it in either direction (the quote it came from,
   * its credit notes, the final invoice of a proforma…).
   */
  async detail(db: TenantDb, id: string) {
    const invoice = await this.requireInvoice(db, id);
    const [contact] = invoice.contactId
      ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)).limit(1)
      : [];
    const items = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id))
      .orderBy(asc(schema.invoiceLineItems.sortOrder));
    const totals = computeVatBreakdown(items, { reverseCharge: invoice.reverseCharge });

    const relatedRows = await db
      .select({
        id: schema.invoices.id,
        documentType: schema.invoices.documentType,
        invoiceNumber: schema.invoices.invoiceNumber,
        status: schema.invoices.status,
        issueDate: schema.invoices.issueDate,
        relatedInvoiceId: schema.invoices.relatedInvoiceId,
      })
      .from(schema.invoices)
      .where(
        invoice.relatedInvoiceId
          ? or(eq(schema.invoices.relatedInvoiceId, id), eq(schema.invoices.id, invoice.relatedInvoiceId))
          : eq(schema.invoices.relatedInvoiceId, id),
      );

    // The document keeps the parties as they were on its issue date; the page
    // notes it when today's Fakturační údaje or contact say something else.
    const [liveTenant] = invoice.sellerSnapshot
      ? await db.select().from(schema.tenants).where(eq(schema.tenants.id, invoice.tenantId)).limit(1)
      : [];
    const payee = liveTenant ? await resolveTenantForInvoice(db, liveTenant, invoice) : null;

    return {
      invoice: { ...invoice, isOverdue: isOverdue(invoice) },
      /** The live contact (link, e-mail for sending). */
      contact: contact ?? null,
      /** The buyer as printed on the document. */
      buyer: contact ? applyBuyerSnapshot(contact, invoice.buyerSnapshot) : null,
      snapshot: {
        sellerDiffers: snapshotDiffers(invoice.sellerSnapshot, payee, SELLER_SNAPSHOT_KEYS),
        buyerDiffers: snapshotDiffers(invoice.buyerSnapshot, contact, BUYER_SNAPSHOT_KEYS),
      },
      items: items.map((item) => ({
        ...item,
        lineTotalWithoutVat: round2(lineBase(item)),
      })),
      totals,
      parent: relatedRows.find((r) => r.id === invoice.relatedInvoiceId) ?? null,
      children: relatedRows.filter((r) => r.relatedInvoiceId === id),
    };
  }

  /**
   * Record a payment. Without `amount` the document is paid in full; with it
   * the amount is added to `amountPaid` and the document stays issued
   * ("částečně uhrazeno") until the sum reaches the total. `fee` and
   * `receivedCzk` add up over partial payments, so the detail can show the
   * net margin after provider fees and currency conversion.
   */
  async markPaid(db: TenantDb, id: string, paidAt?: Date, amount?: number, net: { fee?: number; receivedCzk?: number } = {}) {
    const invoice = await this.requireInvoice(db, id);
    if (invoice.status !== "issued") {
      throw new BadRequestException("Only an issued, unpaid document can be marked as paid");
    }
    if (invoice.documentType === "quote") throw new BadRequestException("A quote is not paid");
    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id));
    const total = round2(computeInvoiceTotal(lineItems, { reverseCharge: invoice.reverseCharge }));
    const paidSoFar = round2(Number(invoice.amountPaid) + (amount ?? total));
    const full = amount == null || paidSoFar >= total - 0.005;
    const netSet = {
      ...(net.fee ? { paymentFees: round2(Number(invoice.paymentFees) + net.fee).toFixed(2) } : {}),
      ...(net.receivedCzk ? { receivedCzk: round2(Number(invoice.receivedCzk ?? 0) + net.receivedCzk).toFixed(2) } : {}),
    };
    const [updated] = await db
      .update(schema.invoices)
      .set(
        full
          ? { status: "paid", paidAt: paidAt ?? new Date(), amountPaid: total.toFixed(2), ...netSet, updatedAt: new Date() }
          : { amountPaid: paidSoFar.toFixed(2), ...netSet, updatedAt: new Date() },
      )
      .where(eq(schema.invoices.id, id))
      .returning();
    if (updated && full) this.ping(updated, "invoice_paid", `Faktura ${updated.invoiceNumber ?? ""} je zaplacená`.replace("  ", " "));
    if (updated) {
      await this.log(db, updated, full ? "marked_paid" : "partial_payment", [
        { field: "amountPaid", from: Number(invoice.amountPaid), to: Number(updated.amountPaid) },
      ]);
    }
    return updated;
  }

  async markUnpaid(db: TenantDb, id: string) {
    const invoice = await this.requireInvoice(db, id);
    if (invoice.status !== "paid") throw new BadRequestException("The document is not marked as paid");
    const [updated] = await db
      .update(schema.invoices)
      .set({ status: "issued", paidAt: null, amountPaid: "0", paymentFees: "0", receivedCzk: null, updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();
    await this.log(db, updated, "marked_unpaid");
    return updated;
  }

  /**
   * Issues a new secret link for the client view (/i/{token}); the old one
   * stops working at once. For a link that reached the wrong person or
   * leaked with an e-mail. Already sent e-mails keep the old, now dead link.
   */
  async rotatePublicToken(db: TenantDb, id: string) {
    const invoice = await this.requireInvoice(db, id);
    const [updated] = await db
      .update(schema.invoices)
      .set({ publicToken: randomUUID(), updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning({ id: schema.invoices.id, publicToken: schema.invoices.publicToken });
    await this.log(db, invoice, "link_rotated");
    return updated;
  }

  /**
   * Cancel ("stornovat") an issued document. Its number stays used — CZ law
   * forbids reusing it — and an invoice that was already reported for VAT
   * should be corrected with a credit note instead; the UI says so.
   */
  async cancel(db: TenantDb, id: string) {
    const invoice = await this.requireInvoice(db, id);
    if (invoice.status === "cancelled") return invoice;
    if (ISSUABLE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException("A draft is deleted, not cancelled");
    }
    const [updated] = await db
      .update(schema.invoices)
      .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();
    await this.log(db, updated, "cancelled");
    return updated;
  }

  /**
   * Creates a new draft from an existing document:
   *   - quote → invoice or proforma (same items),
   *   - proforma → final invoice ("Uhrazeno zálohou č. …"; issued as paid
   *     when the proforma was paid),
   *   - invoice → credit note (same items with negated quantities, to be
   *     trimmed down to what is actually being corrected).
   * The source document is linked via `relatedInvoiceId` and left as is.
   */
  async convert(db: TenantDb, tenantId: string, id: string, to: "invoice" | "credit_note" | "proforma") {
    const source = await this.requireInvoice(db, id);
    const allowed: Record<InvoiceRow["documentType"], string[]> = {
      quote: ["invoice", "proforma"],
      proforma: ["invoice"],
      invoice: ["credit_note"],
      credit_note: [],
    };
    if (!allowed[source.documentType].includes(to)) {
      throw new BadRequestException(`A ${source.documentType} cannot be converted to a ${to}`);
    }
    if (source.status === "cancelled") throw new BadRequestException("The document is cancelled");
    if (source.documentType !== "quote" && !source.invoiceNumber) {
      throw new BadRequestException("Issue the document first");
    }
    if (!source.contactId) throw new BadRequestException("The document has no customer");

    const items = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id))
      .orderBy(asc(schema.invoiceLineItems.sortOrder));

    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    const dueDays = tenant?.defaultDueDays ?? 14;
    const today = new Date();
    const sourceLabel = source.invoiceNumber
      ? `${DOCUMENT_LABEL_CS[source.documentType]} č. ${source.invoiceNumber}`
      : DOCUMENT_LABEL_CS[source.documentType];
    const noteAbove =
      to === "credit_note"
        ? `Opravný daňový doklad k ${sourceLabel}. Důvod opravy: `
        : source.documentType === "proforma"
          ? `Vyúčtování ${sourceLabel}.${source.status === "paid" ? " Uhrazeno zálohou." : ""}`
          : (source.noteAbove ?? null);

    const [draft] = await db
      .insert(schema.invoices)
      .values({
        tenantId,
        contactId: source.contactId,
        documentType: to,
        relatedInvoiceId: source.id,
        currency: source.currency,
        issueDate: today,
        dueDate: new Date(today.getTime() + dueDays * 86_400_000),
        paymentMethod: source.paymentMethod,
        paymentMethodLabel: source.paymentMethodLabel,
        paymentInstructions: source.paymentInstructions,
        constantSymbol: source.constantSymbol,
        specificSymbol: source.specificSymbol,
        orderNumber: source.orderNumber,
        issuePlace: source.issuePlace,
        issuedByName: source.issuedByName,
        customFields: source.customFields,
        noteAbove,
        noteBelow: source.noteBelow,
        language: source.language,
        reverseCharge: source.reverseCharge,
        bankAccountId: source.bankAccountId,
        status: "draft",
        source: "manual",
      })
      .returning();

    if (items.length > 0) {
      await db.insert(schema.invoiceLineItems).values(
        items.map((item, index) => ({
          tenantId,
          invoiceId: draft.id,
          description: item.description,
          quantity: to === "credit_note" ? (-Number(item.quantity)).toString() : item.quantity,
          unit: item.unit,
          code: item.code,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          discountPercent: item.discountPercent,
          sortOrder: index,
        })),
      );
    }
    await this.log(db, source, `converted_${to}`);
    await this.log(db, draft, "created");
    return draft;
  }

  /**
   * Line-item typeahead: descriptions this tenant has invoiced before that
   * contain the query, most recent first, each with the price and VAT rate
   * it was last billed at — so a repeat item is one pick instead of three
   * fields. Plain SQL over the tenant's own history; no AI involved.
   */
  async itemSuggestions(db: TenantDb, rawQuery: string) {
    const q = rawQuery.trim();
    if (q.length < 2) return [];
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const rows = await db
      .selectDistinctOn([schema.invoiceLineItems.description], {
        description: schema.invoiceLineItems.description,
        unitPrice: schema.invoiceLineItems.unitPrice,
        vatRate: schema.invoiceLineItems.vatRate,
        unit: schema.invoiceLineItems.unit,
        lastUsed: schema.invoiceLineItems.createdAt,
      })
      .from(schema.invoiceLineItems)
      .where(ilike(schema.invoiceLineItems.description, `%${escaped}%`))
      .orderBy(schema.invoiceLineItems.description, desc(schema.invoiceLineItems.createdAt))
      .limit(30);
    return rows
      .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime())
      .slice(0, 8)
      .map(({ description, unitPrice, vatRate, unit }) => ({
        description,
        unit,
        unitPrice: Number(unitPrice),
        vatRate: vatRate == null ? null : Number(vatRate),
      }));
  }

  /**
   * "Duplicate": an existing invoice as the starting point for a new one —
   * the same customer, currency, payment term (due minus issue date) and
   * line items. Nothing is written; the form shows it and the person saves
   * a fresh draft with today's dates.
   */
  async duplicateTemplate(db: TenantDb, id: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!invoice) throw new NotFoundException("Invoice not found");
    const [contact] = invoice.contactId
      ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)).limit(1)
      : [];
    const items = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id))
      .orderBy(asc(schema.invoiceLineItems.sortOrder));
    const dueInDays =
      invoice.issueDate && invoice.dueDate
        ? Math.max(0, Math.round((new Date(invoice.dueDate).getTime() - new Date(invoice.issueDate).getTime()) / 86_400_000))
        : null;
    return {
      sourceNumber: invoice.invoiceNumber,
      contact: contact ?? null,
      documentType: invoice.documentType,
      currency: invoice.currency,
      bankAccountId: invoice.bankAccountId,
      dueInDays,
      paymentMethod: invoice.paymentMethod,
      paymentMethodLabel: invoice.paymentMethodLabel,
      paymentInstructions: invoice.paymentInstructions,
      constantSymbol: invoice.constantSymbol,
      specificSymbol: invoice.specificSymbol,
      orderNumber: invoice.orderNumber,
      issuePlace: invoice.issuePlace,
      issuedByName: invoice.issuedByName,
      customFields: invoice.customFields,
      noteAbove: invoice.noteAbove,
      noteBelow: invoice.noteBelow,
      language: invoice.language,
      reverseCharge: invoice.reverseCharge,
      items: items.map((item) => ({
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit,
        code: item.code,
        discountPercent: Number(item.discountPercent),
        unitPrice: Number(item.unitPrice),
        vatRate: item.vatRate == null ? null : Number(item.vatRate),
      })),
    };
  }

  /**
   * "Podle poslední faktury": the most recently created document (credit
   * notes left out, they only make sense against their invoice) as a
   * starting point, exactly like duplicateTemplate. Nothing is written.
   */
  async latestDuplicateTemplate(db: TenantDb) {
    const [latest] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(ne(schema.invoices.documentType, "credit_note"))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(1);
    if (!latest) throw new NotFoundException("No invoice yet");
    return this.duplicateTemplate(db, latest.id);
  }

  findOne(db: TenantDb, id: string) {
    return db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  }

  /**
   * The contract the AI microservice depends on (blueprint §6 step 8, §9).
   * Always creates `status = 'pending_review'`; never allocates an invoice
   * number; never auto-finalizes. `tenantId` is passed explicitly (rather
   * than trusted implicitly) so callers can't accidentally rely on it
   * matching `db`'s bound tenant context without saying so — RLS's
   * `WITH CHECK` policy will reject the insert outright if it doesn't.
   */
  async createDraft(db: TenantDb, tenantId: string, dto: CreateInvoiceDraftDto) {
    // TODO: resolve/create the `contacts` row from
    // dto.extracted_data.counterparty_name_raw /
    // dto.extracted_data.counterparty_ico via @faktur/cz-compliance's ARES
    // client (blueprint §6 step 7) instead of leaving contactId null.
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        tenantId,
        contactId: null,
        currency: dto.extracted_data.currency,
        status: "pending_review",
        source: toInvoiceSource(dto.source),
        aiConfidenceScore: dto.ai_confidence_score.toString(),
        // due_date_hint is free text ("do 14 dnů"), not a parsable date —
        // deliberately left unset; the reviewer sets a real due_date during
        // human review (blueprint §6 step 6/9).
        dueDate: null,
        needsAttention: dto.needs_attention,
        rawAiPayload: {
          rawTranscript: dto.raw_transcript,
          extractedData: dto.extracted_data,
          aresEnrichment: dto.ares_enrichment ?? null,
        },
      })
      .returning();

    if (dto.extracted_data.line_items.length > 0) {
      await db.insert(schema.invoiceLineItems).values(
        dto.extracted_data.line_items.map((item, index) => ({
          tenantId,
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unit_price.toString(),
          vatRate: item.vat_rate != null ? item.vat_rate.toString() : null,
          sortOrder: index,
        })),
      );
    }

    this.ping(
      invoice,
      "draft_ready",
      "Nový návrh faktury ke kontrole",
      dto.extracted_data.counterparty_name_raw ? `Odběratel: ${dto.extracted_data.counterparty_name_raw}` : undefined,
    );
    return invoice;
  }

  /**
   * `POST /api/v1/invoices/:id/send` — loads the invoice + its contact
   * through the normal RLS-scoped `db` (never the public
   * `get_public_invoice_view` SECURITY DEFINER function, which exists only
   * for the no-auth client-portal view), emails it via
   * `EmailService.sendInvoiceEmail`, then stamps `sent_at`.
   */
  async sendInvoice(db: TenantDb, id: string, tenantId?: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (!invoice.contactId) {
      throw new BadRequestException("Invoice has no contact to send it to");
    }

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, invoice.contactId))
      .limit(1);

    if (!contact?.email) {
      throw new BadRequestException("This invoice's contact has no email address on file");
    }

    const lineItems = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id));
    const total = computeInvoiceTotal(lineItems, { reverseCharge: invoice.reverseCharge });

    // Already in the customer's hands and edited since ("Přesto upravit"):
    // the email says it is a corrected copy that replaces the earlier one.
    const corrected = invoice.sentAt ? await this.editedSince(db, id, invoice.sentAt) : false;

    await assertCanSendEmail(db, invoice.tenantId);
    await this.emailService.sendInvoiceEmail({
      corrected,
      to: contact.email,
      invoiceNumber: invoice.invoiceNumber ?? invoice.id,
      amount: formatInvoiceAmount(total, invoice.currency),
      dueDate: invoice.dueDate,
      publicToken: invoice.publicToken,
      clientPortalToken: contact.portalToken,
      ...(tenantId ? { custom: await this.emailCustomization(db, tenantId, invoice, contact, "invoice") } : {}),
    });
    await recordEmailSent(db, invoice.tenantId, "invoice", contact.email);

    const [updated] = await db
      .update(schema.invoices)
      .set({ sentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();

    this.ping(updated, "invoice_sent", `Faktura ${updated.invoiceNumber ?? ""} odeslána`, `Komu: ${contact.email}`);
    await this.log(db, updated, corrected ? "sent_corrected" : "sent", [{ field: "email", from: null, to: contact.email }]);
    return updated;
  }

  /** Whether the issued invoice was edited in place after `since` (its last send). */
  async editedSince(db: TenantDb, id: string, since: Date) {
    const [row] = await db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.entityType, "invoice"),
          eq(schema.auditLog.entityId, id),
          eq(schema.auditLog.action, "edited_issued"),
          gt(schema.auditLog.createdAt, since),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /**
   * "Poslat upomínku" from the invoice detail: the same email the daily sweep
   * sends, on demand. Counts towards `reminder_count` and restarts the
   * sweep's cooldown, so the customer doesn't get a second one tomorrow.
   */
  async sendReminder(db: TenantDb, id: string, tenantId?: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${id} not found`);
    if (invoice.status !== "issued") throw new BadRequestException("Only an issued, unpaid invoice can be reminded");
    const [contact] = invoice.contactId
      ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)).limit(1)
      : [];
    if (!contact?.email) throw new BadRequestException("This invoice's contact has no email address on file");

    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id));
    const total = computeInvoiceTotal(lineItems, { reverseCharge: invoice.reverseCharge });
    await assertCanSendEmail(db, invoice.tenantId);
    await this.emailService.sendPaymentReminderEmail({
      to: contact.email,
      invoiceNumber: invoice.invoiceNumber ?? invoice.id,
      amount: formatInvoiceAmount(total, invoice.currency),
      dueDate: invoice.dueDate,
      publicToken: invoice.publicToken,
      clientPortalToken: contact.portalToken,
      reminderCount: invoice.reminderCount + 1,
      ...(tenantId ? { custom: await this.emailCustomization(db, tenantId, invoice, contact, "reminder") } : {}),
    });
    await recordEmailSent(db, invoice.tenantId, "reminder", contact.email);
    const [updated] = await db
      .update(schema.invoices)
      .set({ reminderCount: sql`${schema.invoices.reminderCount} + 1`, lastReminderSentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();
    this.ping(updated, "reminder_sent", `Upomínka č. ${updated.reminderCount} k faktuře ${updated.invoiceNumber ?? ""}`, `Komu: ${contact.email}`);
    await this.log(db, updated, "reminder_sent", [{ field: "email", from: null, to: contact.email }]);
    return updated;
  }

  /**
   * Marks an invoice paid as a side effect of automated or manual bank-
   * statement reconciliation (`BankReconciliationService`, both its
   * auto-match path and the manual `.../match` override). Only transitions
   * `status = 'issued' -> 'paid'` — the `WHERE` clause guards the status,
   * not just a blind `UPDATE ... SET status = 'paid'` — so calling this
   * twice for the same invoice (e.g. a re-run import, or a race between
   * auto-match and a manual override) is a no-op the second time rather
   * than silently re-stamping `updatedAt`, and an invoice that was
   * meanwhile cancelled can't be resurrected into "paid" by a late-arriving
   * bank transaction. `tenantId` is required explicitly (not inferred from
   * `db`'s bound context) for the same reason `createDraft` takes it
   * explicitly — RLS's `WITH CHECK`/`USING` still enforces it either way,
   * but requiring it here makes the caller's intent explicit at the call
   * site. Returns `null` (not a thrown error) when no row transitioned, so
   * callers can decide for themselves whether that's worth surfacing.
   */
  async markPaidFromReconciliation(
    db: TenantDb,
    invoiceId: string,
    tenantId: string,
    received?: { amount: number; currency: string; fee?: number },
  ) {
    // A CZK credit settling a foreign-currency invoice is the real proceeds
    // after the bank's conversion; keep it for the margin / exchange difference.
    const [current] = await db
      .select({ currency: schema.invoices.currency, paymentFees: schema.invoices.paymentFees })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId));
    const receivedCzk =
      received && received.currency.toUpperCase() === "CZK" && current && current.currency !== "CZK" && received.amount > 0
        ? { receivedCzk: round2(received.amount).toFixed(2) }
        : {};
    // Fee the payment provider kept (PayPal), booked like a manual "net received" entry.
    const fee =
      received?.fee && received.fee > 0 && current && received.currency.toUpperCase() === current.currency
        ? { paymentFees: round2(Number(current.paymentFees) + received.fee).toFixed(2) }
        : {};
    const [updated] = await db
      .update(schema.invoices)
      .set({ status: "paid", paidAt: new Date(), ...receivedCzk, ...fee, updatedAt: new Date() })
      .where(
        and(
          eq(schema.invoices.id, invoiceId),
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.status, "issued"),
        ),
      )
      .returning();

    if (updated) {
      this.ping(updated, "invoice_paid", `Faktura ${updated.invoiceNumber ?? ""} je zaplacená`, "Platbu jsme spárovali z bankovního výpisu.");
      await this.log(db, updated, "paid_from_bank");
    }
    return updated ?? null;
  }

  /**
   * `POST /api/v1/invoices/:id/issue` — the legal moment of responsibility
   * transfer (blueprint §9): allocates the immutable sequential invoice
   * number, stamps the liability audit-trail columns, and flips
   * `status -> 'issued'`. All reads/writes below go through `db`
   * (`req.tenantDb`), which is already inside the single RLS-scoped
   * transaction `TenantContextMiddleware` opens for the whole request (see
   * its doc comment) — there is no separate `sql.begin()` needed here for
   * "one transaction per issuance": it's already the one this handler is
   * running in.
   *
   * Deliberately does NOT generate/store the PDF or ISDOC XML here — see
   * `generateInvoicePdf`/`generateInvoiceIsdoc` below and this module's
   * README-level note on the persist-vs-regenerate-on-demand decision:
   * both documents are fully re-derivable at any time from the columns this
   * method sets (`invoiceNumber`/`issueDate`/`dueDate`/`variableSymbol`)
   * plus the invoice's line items/contact/tenant, so persisting a rendered
   * copy would only be a cache — and an on-demand render from source data
   * can never drift out of sync with it the way a stored copy could after,
   * say, a bugfix to the PDF layout.
   *
   * Guards (each throws before any write happens):
   *   - invoice must exist (404) and already have a contact + at least one
   *     line item + a due date set (400) — issuing a legal document with no
   *     recipient, no content, or no payment deadline would be nonsensical,
   *     and `dueDate`/`contactId` are exactly the fields the blueprint's
   *     human-review step (§6 step 6/9) is responsible for filling in
   *     before an AI draft can ever reach this endpoint.
   *   - `status` must be `draft` or `pending_review` (400 otherwise) — an
   *     already-`issued`/`paid`/`cancelled` invoice can never be re-issued;
   *     CZ/SK law requires the sequential number to be assigned exactly
   *     once, permanently.
   */
  async issue(db: TenantDb, tenantId: string, invoiceId: string, userId: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (!ISSUABLE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException(
        `Invoice ${invoiceId} cannot be issued from status "${invoice.status}" — only ` +
          `${ISSUABLE_STATUSES.join("/")} invoices can be issued`,
      );
    }

    const noCustomer = customerRequiredError("issue", invoice.contactId);
    if (noCustomer) throw new BadRequestException(noCustomer);

    if (!invoice.dueDate && invoice.documentType !== "quote") {
      throw new BadRequestException("Invoice has no due date — set one before issuing");
    }
    const related = await this.checkRelated(db, invoice.documentType, invoice.relatedInvoiceId);

    const lineItems = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, invoiceId));
    if (lineItems.length === 0) {
      throw new BadRequestException("Invoice has no line items — add at least one before issuing");
    }

    const now = new Date();
    // The date the person chose on the form wins; numbering follows its year
    // (and month, for a pattern with {MM}) in the company's own number format.
    const issueDate = invoice.issueDate ?? now;
    const formats = await loadNumberFormats(db, tenantId);
    const { invoiceNumber } = await allocateInvoiceNumber(db, tenantId, invoice.documentType, new Date(issueDate), formats);
    const variableSymbol = invoice.variableSymbol ?? variableSymbolFor(invoice.documentType, invoiceNumber);
    // "Already paid" entered on the draft: in full → paid at issue, otherwise a partial payment.
    const total = round2(computeInvoiceTotal(lineItems, { reverseCharge: invoice.reverseCharge }));
    const prepaidInFull = invoice.documentType !== "quote" && total > 0 && Number(invoice.amountPaid) >= total - 0.005;
    const settledByProforma =
      prepaidInFull ||
      (invoice.documentType === "invoice" && related?.documentType === "proforma" && related.status === "paid");
    // The supplier and buyer as they stand right now, kept with the document
    // so a later change of address or DIČ does not rewrite it (§29, §34–35 ZDPH).
    const { sellerSnapshot, buyerSnapshot } = await this.captureParties(db, tenantId, invoice, now);

    // Foreign-currency documents carry their CZK rate, so the PDF and the VAT
    // returns can convert them (§38 ZDPH); which rate follows the company's
    // setting (exchange-rate-mode.ts). A failed ČNB lookup leaves it null;
    // the VAT export looks it up again later.
    const { exchangeRate, exchangeRateMode, exchangeRateDate } = await this.issueRate(db, tenantId, invoice, lineItems, issueDate);

    const [updated] = await db
      .update(schema.invoices)
      .set({
        invoiceNumber,
        variableSymbol,
        issueDate,
        sellerSnapshot,
        buyerSnapshot,
        status: settledByProforma ? "paid" : "issued",
        paidAt: settledByProforma ? (prepaidInFull ? issueDate : (related?.paidAt ?? now)) : null,
        amountPaid: settledByProforma ? total.toFixed(2) : invoice.documentType === "quote" ? "0" : invoice.amountPaid,
        issuedByUserId: userId,
        issuedAt: now,
        exchangeRate,
        exchangeRateMode,
        exchangeRateDate,
        // Only an AI-sourced draft has a meaningful "reviewed" moment
        // distinct from "issued" (blueprint §9) — a manual/api/recurring
        // invoice was never an unreviewed AI draft in the first place, so
        // leave this null for those rather than fabricating a value.
        aiDraftReviewedAt:
          invoice.source === "ai_telegram" || invoice.source === "ai_whatsapp"
            ? (invoice.aiDraftReviewedAt ?? now)
            : invoice.aiDraftReviewedAt,
        updatedAt: now,
      })
      .where(eq(schema.invoices.id, invoiceId))
      .returning();

    await this.log(db, updated, "issued", [{ field: "invoiceNumber", from: null, to: updated.invoiceNumber }]);
    return updated;
  }

  /**
   * The CZK rate a document gets at issue and how it was chosen: a rate typed
   * on the draft, or the ČNB list valid on the taxable supply date (issue
   * date when there is none). A typed rate that is ČNB's for that day (the
   * form's "Načíst z ČNB" button) is stored as the ČNB rate, with its list
   * day. The jednotný kurz never goes on a document (exchange-rate-mode.ts).
   * Nothing for CZK documents.
   */
  private async issueRate(
    db: TenantDb,
    tenantId: string,
    invoice: Pick<InvoiceRow, "currency" | "exchangeRate" | "taxableSupplyDate" | "reverseCharge">,
    lineItems: (typeof schema.invoiceLineItems.$inferSelect)[],
    issueDate: Date,
  ): Promise<{ exchangeRate: string | null; exchangeRateMode: StoredRateMode | null; exchangeRateDate: string | null }> {
    if (invoice.currency === "CZK") return { exchangeRate: null, exchangeRateMode: null, exchangeRateDate: null };
    const [tenant] = await db
      .select({ invoiceFormPrefs: schema.tenants.invoiceFormPrefs, vatStatus: schema.tenants.vatStatus })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);
    const settings = exchangeRateSettingsOf(tenant?.invoiceFormPrefs);
    const day = new Date(invoice.taxableSupplyDate ?? issueDate);
    const cnb = await getCnbDay(day);
    const cnbRate = cnb?.rates.get(invoice.currency.toUpperCase())?.rate ?? null;
    const manualRate = invoice.exchangeRate == null ? null : Number(invoice.exchangeRate);
    const { mode, source } = resolveRateMode({
      setting: settings.mode,
      vatStatus: tenant?.vatStatus ?? "non_payer",
      totalVat: computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge }).totalVat,
      manualRate,
      manualIsCnb: manualRate != null && isCnbRate(manualRate, cnbRate),
    });
    if (source === "manual") return { exchangeRate: invoice.exchangeRate, exchangeRateMode: mode, exchangeRateDate: null };
    return { exchangeRate: cnbRate == null ? null : cnbRate.toFixed(6), exchangeRateMode: mode, exchangeRateDate: cnbRate == null ? null : cnb!.date };
  }

  /**
   * Supplier (with the account the document is paid to) and buyer exactly as
   * they stand now, for the moment a document leaves the draft stage.
   */
  private async captureParties(
    db: TenantDb,
    tenantId: string,
    invoice: Pick<InvoiceRow, "contactId" | "bankAccountId" | "currency">,
    at: Date = new Date(),
    source: "issue" | "manual_refresh" = "issue",
  ) {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    const [contact] = invoice.contactId
      ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)).limit(1)
      : [];
    return {
      sellerSnapshot: tenant ? sellerSnapshotOf(await resolveTenantForInvoice(db, tenant, invoice), at, source) : null,
      buyerSnapshot: contact ? buyerSnapshotOf(contact, at, source) : null,
    };
  }

  /**
   * "Aktualizovat údaje dodavatele / odběratele": an explicit, logged choice
   * to replace an issued document's snapshot with the current details (e.g.
   * a typo in the DIČ at issue). Never happens on its own.
   */
  async refreshPartySnapshot(db: TenantDb, tenantId: string, id: string, party: "seller" | "buyer" | "both", reason?: string | null) {
    const invoice = await this.requireInvoice(db, id);
    if (ISSUABLE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException("A draft always shows the current details");
    }
    if (invoice.status === "cancelled") throw new BadRequestException("A cancelled document cannot be edited");
    const fresh = await this.captureParties(db, tenantId, invoice, new Date(), "manual_refresh");
    const values: Partial<typeof schema.invoices.$inferInsert> = {};
    if (party !== "buyer") values.sellerSnapshot = fresh.sellerSnapshot;
    if (party !== "seller") values.buyerSnapshot = fresh.buyerSnapshot;
    const [updated] = await db
      .update(schema.invoices)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();
    const changes = [
      ...(party !== "buyer" ? snapshotChanges("seller", invoice.sellerSnapshot, fresh.sellerSnapshot, SELLER_SNAPSHOT_KEYS) : []),
      ...(party !== "seller" ? snapshotChanges("buyer", invoice.buyerSnapshot, fresh.buyerSnapshot, BUYER_SNAPSHOT_KEYS) : []),
    ];
    await this.log(db, updated, "edited_issued", changes, reason?.trim() || "Aktualizace údajů podle současného stavu");
    return updated;
  }

  /**
   * Loads everything `buildIsdocInvoiceInput`/`InvoicePdfService.generate`
   * need for an already-issued invoice: the invoice itself, its contact,
   * the issuing tenant, and its line items. Shared by both
   * `generateInvoicePdf` and `generateInvoiceIsdoc` so the "not issued yet"/
   * "not found" guards live in exactly one place.
   */
  private async loadIssuedInvoiceForDocument(db: TenantDb, tenantId: string, invoiceId: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    if (!invoice.invoiceNumber) {
      throw new BadRequestException("Invoice has not been issued yet — no document to generate");
    }

    if (!invoice.contactId) {
      // Should be unreachable in practice (issue() requires a contact
      // before allocating a number), but guarded rather than assumed —
      // this method reads from the DB fresh, not from issue()'s in-memory
      // state.
      throw new BadRequestException("Invoice has no contact on file");
    }

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, invoice.contactId))
      .limit(1);
    if (!contact) {
      throw new NotFoundException(`Contact ${invoice.contactId} not found`);
    }

    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const lineItems = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, invoiceId));

    lineItems.sort((a, b) => a.sortOrder - b.sortOrder);
    const [related] = invoice.relatedInvoiceId
      ? await db
          .select({ invoiceNumber: schema.invoices.invoiceNumber, documentType: schema.invoices.documentType })
          .from(schema.invoices)
          .where(eq(schema.invoices.id, invoice.relatedInvoiceId))
          .limit(1)
      : [];

    // Payment details: the account chosen on the invoice / matching its currency.
    const payee = await resolveTenantForInvoice(db, tenant, invoice);
    // As on the document: the snapshot taken at issue, live data without one.
    const parties = documentParties(invoice, payee, contact);
    return { invoice, contact: parties.contact, tenant: parties.tenant, lineItems, related: related ?? null };
  }

  /**
   * `GET /api/v1/invoices/:id/pdf` — regenerates the invoice PDF on demand
   * from current source data (see the persist-vs-regenerate note on
   * `issue()` above) rather than reading back a previously stored file.
   */
  async generateInvoicePdf(db: TenantDb, tenantId: string, invoiceId: string): Promise<Buffer> {
    const { invoice, contact, tenant, lineItems, related } = await this.loadIssuedInvoiceForDocument(
      db,
      tenantId,
      invoiceId,
    );
    const totals = computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge });
    return this.invoicePdfService.generate(invoice, contact, tenant, lineItems, totals, related);
  }

  /**
   * `GET /api/v1/invoices/:id/isdoc` — same regenerate-on-demand approach
   * as `generateInvoicePdf`, via `@faktur/cz-compliance`'s `generateIsdocXml`.
   */
  async generateInvoiceIsdoc(db: TenantDb, tenantId: string, invoiceId: string): Promise<string> {
    const { invoice, contact, tenant, lineItems } = await this.loadIssuedInvoiceForDocument(
      db,
      tenantId,
      invoiceId,
    );
    const totals = computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge });
    const input = buildIsdocInvoiceInput(invoice, contact, tenant, lineItems, totals);
    return generateIsdocXml(input);
  }

  /**
   * UBL 2.1 / Peppol BIS Billing 3.0 XML of an issued invoice, for the SK
   * e-invoicing mandate (1 January 2027). Built from the same input as the
   * ISDOC export. Only plain invoices: Peppol carries credit notes as a
   * separate document, and proformas and quotes are not tax documents.
   */
  async generateInvoiceUbl(db: TenantDb, tenantId: string, invoiceId: string): Promise<string> {
    const { invoice, contact, tenant, lineItems } = await this.loadIssuedInvoiceForDocument(
      db,
      tenantId,
      invoiceId,
    );
    if (invoice.documentType !== "invoice") {
      throw new BadRequestException("ubl_invoice_only");
    }
    const totals = computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge });
    const input = buildIsdocInvoiceInput(invoice, contact, tenant, lineItems, totals);
    return generateUblInvoiceXml(input, { reverseCharge: invoice.reverseCharge });
  }

  /**
   * Legal-content check of a document (drafts too): the CZ/SK mandatory
   * fields, plus the Peppol rules for an issued invoice to a foreign buyer.
   */
  async checkInvoice(
    db: TenantDb,
    tenantId: string,
    invoiceId: string,
  ): Promise<{ issues: ((RequirementIssue & { scheme: "law" }) | (PeppolIssue & { scheme: "peppol" }))[] }> {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    const [liveTenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!liveTenant) throw new NotFoundException(`Tenant ${tenantId} not found`);
    const [liveContact] = invoice.contactId
      ? await db.select().from(schema.contacts).where(eq(schema.contacts.id, invoice.contactId)).limit(1)
      : [];
    // An issued document is checked as it was issued (its snapshot), a draft against live data.
    const { tenant, contact } = documentParties(invoice, liveTenant, liveContact);
    const lineItems = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoiceId));

    const law = checkInvoiceRequirements({
      supplier: { ...tenantToIsdocParty(tenant), registryNote: tenant.registryNote ?? undefined },
      customer: contact ? { ...contactToIsdocParty(contact), isPerson: contact.isPerson } : undefined,
      vatStatus: tenant.vatStatus,
      reverseCharge: invoice.reverseCharge,
      taxDocument: invoice.documentType === "invoice" || invoice.documentType === "credit_note",
      lines: lineItems.map((l) => ({ description: l.description, quantity: Number(l.quantity) })),
    }).map((i) => ({ ...i, scheme: "law" as const }));

    let peppol: (PeppolIssue & { scheme: "peppol" })[] = [];
    if (invoice.invoiceNumber && invoice.documentType === "invoice" && contact && contact.addressCountry !== "CZ" && lineItems.length) {
      const { issues } = await this.checkInvoiceUbl(db, tenantId, invoiceId);
      // The law check already reports what both would say about names and addresses.
      const seen = new Set(law.map((i) => `${i.field}:${i.code}`));
      peppol = issues.filter((i) => !seen.has(`${i.field}:${i.code}`)).map((i) => ({ ...i, scheme: "peppol" as const }));
    }
    return { issues: [...law, ...peppol] };
  }

  /** Peppol pre-flight for the UBL export: what an access point would reject or flag. */
  async checkInvoiceUbl(db: TenantDb, tenantId: string, invoiceId: string): Promise<{ issues: PeppolIssue[] }> {
    const { invoice, contact, tenant, lineItems } = await this.loadIssuedInvoiceForDocument(db, tenantId, invoiceId);
    if (invoice.documentType !== "invoice") throw new BadRequestException("ubl_invoice_only");
    const totals = computeVatBreakdown(lineItems, { reverseCharge: invoice.reverseCharge });
    const input = buildIsdocInvoiceInput(invoice, contact, tenant, lineItems, totals);
    return { issues: validatePeppolInvoice(input, { reverseCharge: invoice.reverseCharge }) };
  }
}
