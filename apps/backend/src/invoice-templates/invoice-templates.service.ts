import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { asc, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { InvoicesService } from "../invoices/invoices.service";
import { SEALED_ITEM_PLACEHOLDER, documentKeyWrap } from "@faktur/cz-compliance";
import { assertOneDocumentKey, assertSealingAllowed, isSealed } from "../vault/sealed";
import { AMOUNTS_SEALED, amountsSealed } from "../vault/sealed-amounts";
import type {
  BulkInvoiceDto,
  CreateInvoiceTemplateDto,
  UpdateInvoiceTemplateDto,
} from "./dto/invoice-template.dto";

type Db = PostgresJsDatabase<typeof schema>;

function templateTexts(t: { note_above?: string | null; note_below?: string | null; line_items?: { description: string }[] | null }): unknown[] {
  return [t.note_above, t.note_below, ...(t.line_items ?? []).map((i) => i.description)];
}
type TemplateRow = typeof schema.invoiceTemplates.$inferSelect;

/** How line items are stored in `invoice_templates.line_items` (jsonb). */
export interface TemplateLineItem {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number | null;
  discountPercent: number;
  /**
   * Category "amounts": the item's envelope copied from the invoice the
   * template was saved from (the plain fields hold the placeholder). The
   * form opens it with the vault key and seals a new document of its own.
   */
  encAmounts?: string | null;
}

/** The template's amounts are sealed (any item carries an envelope). */
export function templateAmountsSealed(items: TemplateLineItem[]): boolean {
  return items.some((i) => isSealed(i.encAmounts));
}

type SealedCopy = NonNullable<BulkInvoiceDto["sealed"]>[number];

/**
 * The browser's sealed copies of a template with sealed amounts, by
 * customer. Without them the server cannot fill any draft (409
 * amounts_sealed). Each copy carries every item, lives under one document
 * key, and no two copies share a key: one client link must never open
 * another customer's draft.
 */
export function sealedCopies(dto: Pick<BulkInvoiceDto, "sealed" | "issue">, contactIds: string[], itemCount: number): Map<string, SealedCopy> {
  if (!dto.sealed) throw new ConflictException(AMOUNTS_SEALED);
  if (dto.issue) throw new BadRequestException("sealed_bulk_drafts_only");
  const copies = new Map(dto.sealed.map((c) => [c.contact_id, c]));
  if (copies.size !== dto.sealed.length || copies.size !== contactIds.length || contactIds.some((id) => !copies.has(id))) {
    throw new BadRequestException("sealed_bulk_mismatch");
  }
  const keys = new Set<string>();
  for (const copy of copies.values()) {
    if (copy.line_items.length !== itemCount) throw new BadRequestException("sealed_bulk_mismatch");
    const texts = [copy.enc_amounts, ...copy.line_items.map((i) => i.enc_amounts), copy.note_above, copy.note_below, ...copy.line_items.map((i) => i.description)];
    assertOneDocumentKey(texts);
    const key = documentKeyWrap(copy.enc_amounts);
    if (!key || keys.has(key)) throw new BadRequestException("rekey_one_document_key");
    keys.add(key);
  }
  return copies;
}

type LineItemInput = NonNullable<UpdateInvoiceTemplateDto["line_items"]>[number];

function toStoredItems(items: LineItemInput[]): TemplateLineItem[] {
  return items.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    unit: i.unit || null,
    unitPrice: i.unit_price,
    vatRate: i.vat_rate ?? null,
    discountPercent: i.discount_percent ?? 0,
  }));
}

function templateValues(dto: UpdateInvoiceTemplateDto) {
  const v: Partial<typeof schema.invoiceTemplates.$inferInsert> = {};
  if (dto.name !== undefined) v.name = dto.name;
  if (dto.description !== undefined) v.description = dto.description || null;
  if (dto.icon !== undefined) v.icon = dto.icon || null;
  if (dto.contact_id !== undefined) v.contactId = dto.contact_id ?? null;
  if (dto.document_type !== undefined) v.documentType = dto.document_type;
  if (dto.currency !== undefined) v.currency = dto.currency.toUpperCase();
  if (dto.due_in_days !== undefined) v.dueInDays = dto.due_in_days ?? null;
  if (dto.payment_method !== undefined) v.paymentMethod = dto.payment_method;
  if (dto.note_above !== undefined) v.noteAbove = dto.note_above || null;
  if (dto.note_below !== undefined) v.noteBelow = dto.note_below || null;
  if (dto.line_items !== undefined) v.lineItems = toStoredItems(dto.line_items);
  return v;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Saved invoice templates — the gallery the dashboard shows, the
 * "Nová faktura ze šablony" prefill and bulk invoicing (one draft per
 * selected customer, e.g. a monthly fee billed to many clients).
 */
@Injectable()
export class InvoiceTemplatesService {
  constructor(private readonly invoicesService: InvoicesService) {}

  async list(db: Db) {
    const rows = await db
      .select({ template: schema.invoiceTemplates, contactName: schema.contacts.legalName })
      .from(schema.invoiceTemplates)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoiceTemplates.contactId))
      .orderBy(desc(schema.invoiceTemplates.usageCount), asc(schema.invoiceTemplates.name));
    return rows.map(({ template, contactName }) => ({ ...template, contactName }));
  }

  async findOne(db: Db, id: string): Promise<TemplateRow> {
    const [template] = await db.select().from(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.id, id));
    if (!template) throw new NotFoundException("Template not found");
    return template;
  }

  async create(db: Db, tenantId: string, dto: CreateInvoiceTemplateDto) {
    await assertSealingAllowed(db, tenantId, templateTexts(dto));
    const [template] = await db
      .insert(schema.invoiceTemplates)
      .values({ ...templateValues(dto), name: dto.name, tenantId })
      .returning();
    return template;
  }

  /** "Uložit jako šablonu" on an existing document. */
  async createFromInvoice(db: Db, tenantId: string, invoiceId: string, name?: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!invoice) throw new NotFoundException("Invoice not found");
    const items = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(schema.invoiceLineItems.sortOrder));

    const dueInDays =
      invoice.dueDate && invoice.issueDate
        ? Math.max(0, Math.round((invoice.dueDate.getTime() - invoice.issueDate.getTime()) / 86_400_000))
        : null;

    const [template] = await db
      .insert(schema.invoiceTemplates)
      .values({
        tenantId,
        // An encrypted description would make a broken, unreadable name.
        name: name?.trim() || (items[0] && !isSealed(items[0].description) ? items[0].description.slice(0, 120) : "") || "Šablona",
        contactId: invoice.contactId,
        documentType: invoice.documentType === "credit_note" ? "invoice" : invoice.documentType,
        currency: invoice.currency,
        dueInDays,
        paymentMethod: invoice.paymentMethod,
        noteAbove: invoice.noteAbove,
        noteBelow: invoice.noteBelow,
        lineItems: items.map((i) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unit: i.unit,
          unitPrice: Number(i.unitPrice),
          vatRate: i.vatRate != null ? Number(i.vatRate) : null,
          discountPercent: Number(i.discountPercent ?? 0),
          // Without it a template of a sealed invoice would keep only the placeholder: price 0.
          ...(amountsSealed(invoice) && isSealed(i.encAmounts) ? { encAmounts: i.encAmounts } : {}),
        })),
      })
      .returning();
    return template;
  }

  async update(db: Db, tenantId: string, id: string, dto: UpdateInvoiceTemplateDto) {
    const existing = await this.findOne(db, id);
    await assertSealingAllowed(db, tenantId, templateTexts(dto), () => templateTexts({ note_above: existing.noteAbove, note_below: existing.noteBelow, line_items: existing.lineItems as { description: string }[] | null }));
    const [template] = await db
      .update(schema.invoiceTemplates)
      .set({ ...templateValues(dto), updatedAt: new Date() })
      .where(eq(schema.invoiceTemplates.id, id))
      .returning();
    return template;
  }

  async remove(db: Db, id: string) {
    await this.findOne(db, id);
    await db.delete(schema.invoiceTemplates).where(eq(schema.invoiceTemplates.id, id));
    return { ok: true };
  }

  /**
   * One draft per customer from a template. Drafts are created in the given
   * order; with `issue: true` each is issued right away so numbers follow
   * that order too. Everything runs in the request transaction — one bad
   * customer rolls the whole batch back.
   *
   * A template with sealed amounts needs `sealed`: one copy per customer,
   * sealed in the browser under that draft's own document key. Those stay
   * drafts; issuing is a separate click per document.
   */
  async bulk(db: Db, tenantId: string, userId: string, id: string, dto: BulkInvoiceDto) {
    const template = await this.findOne(db, id);
    const items = (template.lineItems as TemplateLineItem[]) ?? [];
    if (items.length === 0) throw new BadRequestException("The template has no line items");
    const contactIds = [...new Set(dto.contact_ids)];
    const sealed = templateAmountsSealed(items) ? sealedCopies(dto, contactIds, items.length) : null;
    const found = await db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, contactIds));
    if (found.length !== contactIds.length) throw new NotFoundException("Some customers were not found");

    const [tenant] = await db
      .select({ defaultDueDays: schema.tenants.defaultDueDays })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const issueDate = dto.issue_date ?? new Date();
    const dueDays = template.dueInDays ?? tenant?.defaultDueDays ?? 14;

    const created = [];
    for (const contactId of contactIds) {
      const copy = sealed?.get(contactId);
      const invoice = await this.invoicesService.create(db, tenantId, {
        document_type: template.documentType === "credit_note" ? "invoice" : template.documentType,
        contact_id: contactId,
        issue_date: issueDate,
        due_date: template.documentType === "quote" ? null : addDays(issueDate, dueDays),
        currency: template.currency,
        payment_method: template.paymentMethod,
        note_above: copy ? (copy.note_above ?? null) : template.noteAbove,
        note_below: copy ? (copy.note_below ?? null) : template.noteBelow,
        language: "cs",
        reverse_charge: false,
        source_ai: false,
        template_id: template.id,
        ...(copy ? { enc_amounts: copy.enc_amounts } : {}),
        line_items: items.map((i, n) =>
          copy
            ? {
                description: copy.line_items[n]!.description,
                quantity: SEALED_ITEM_PLACEHOLDER.quantity,
                unit: i.unit,
                unit_price: SEALED_ITEM_PLACEHOLDER.unitPrice,
                vat_rate: null,
                discount_percent: SEALED_ITEM_PLACEHOLDER.discountPercent,
                enc_amounts: copy.line_items[n]!.enc_amounts,
              }
            : {
                description: i.description,
                quantity: i.quantity,
                unit: i.unit,
                unit_price: i.unitPrice,
                vat_rate: i.vatRate,
                discount_percent: i.discountPercent ?? 0,
              },
        ),
      });
      if (dto.issue) {
        created.push(await this.invoicesService.issue(db, tenantId, invoice.id, userId));
      } else {
        created.push(invoice);
      }
    }
    return { count: created.length, invoices: created };
  }
}
