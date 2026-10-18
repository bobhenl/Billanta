import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { REVERSE_CHARGE_CODE_VALUES } from "@faktur/cz-compliance";

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  // Negative quantities are allowed: a credit note returns items, and a
  // regular invoice may carry a "sleva" line.
  quantity: z.coerce
    .number()
    .refine((n) => n !== 0, "Quantity must not be zero")
    .default(1),
  unit: z.string().trim().max(16).nullish(),
  // Item / product code (SKU, EAN, catalogue number).
  code: z.string().trim().max(32).nullish(),
  unit_price: z.coerce.number(),
  vat_rate: z.coerce.number().min(0).max(100).nullish(),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
});

const optionalText = (max: number) => z.string().trim().max(max).nullish();

/** Everything a person can set on a draft — shared by create and update. */
export const invoiceFieldsSchema = z.object({
  document_type: z.enum(["invoice", "proforma", "credit_note", "quote"]).default("invoice"),
  related_invoice_id: z.string().uuid().nullish(),
  /** Null/missing = no customer yet: allowed for a draft, issuing still needs one. */
  contact_id: z.string().uuid().nullish(),
  issue_date: z.coerce.date().optional(),
  due_date: z.coerce.date().nullish(),
  // DUZP; null/omitted = same as the issue date.
  taxable_supply_date: z.coerce.date().nullish(),
  currency: z.string().length(3).default("CZK"),
  // CZK per 1 unit of `currency`; null = take the ČNB rate at issue time.
  /** One of GET /v1/tenants/me/bank-accounts; null = automatic (currency match, else primary). */
  bank_account_id: z.string().uuid().nullish(),
  exchange_rate: z.coerce.number().positive().max(1_000_000).nullish(),
  payment_method: z.enum(["bank_transfer", "cash", "card", "cash_on_delivery", "other"]).default("bank_transfer"),
  // Custom method (Settings → Způsoby úhrady): printed instead of the built-in name.
  payment_method_label: optionalText(60),
  payment_instructions: optionalText(500),
  variable_symbol: z
    .string()
    .regex(/^\d{1,10}$/)
    .nullish(),
  constant_symbol: z
    .string()
    .regex(/^\d{1,4}$/)
    .nullish(),
  specific_symbol: z
    .string()
    .regex(/^\d{1,10}$/)
    .nullish(),
  order_number: optionalText(64),
  note_above: optionalText(2000),
  note_below: optionalText(2000),
  internal_note: optionalText(2000),
  issue_place: optionalText(100),
  issued_by_name: optionalText(100),
  // Extra header lines ("Číslo smlouvy: 2024/15"); empty pairs are dropped.
  // `internal` ones are team-only notes: never printed, emailed or shown in the portal.
  custom_fields: z
    .array(
      z.object({
        label: z.string().trim().max(40),
        value: z.string().trim().max(200),
        kind: z.enum(["text", "amount", "percent", "formula"]).default("text"),
        internal: z.boolean().default(false),
      }),
    )
    .max(10)
    .transform((rows) =>
      rows
        .filter((r) => r.label && r.value)
        .map((r) => ({ label: r.label, value: r.value, ...(r.kind !== "text" ? { kind: r.kind } : {}), ...(r.internal ? { internal: true } : {}) })),
    )
    .optional(),
  // Already received when the document is created (bitfaktura's "uhrazeno").
  amount_paid: z.number().min(0).max(1_000_000_000).nullish(),
  language: z.enum(["cs", "sk", "en"]).default("cs"),
  reverse_charge: z.boolean().default(false),
  // Kód předmětu plnění (§ 92a–92i ZDPH) for kontrolní hlášení A.1; only the
  // codes EPO accepts today.
  reverse_charge_code: z.enum(REVERSE_CHARGE_CODE_VALUES).nullish(),
  line_items: z.array(lineItemSchema).min(1).max(200),
});

/**
 * A draft typed by a person in the dashboard's invoice form or sent through
 * the public API (as opposed to `CreateInvoiceDraftDto`, the AI-service
 * contract). Always lands as `status = draft`; numbering happens at issue
 * time (`POST /:id/issue`), never here. `source_ai` records that the form was
 * pre-filled from an AI suggestion the user then reviewed.
 */
export const createInvoiceSchema = invoiceFieldsSchema.extend({
  source_ai: z.boolean().default(false),
  // Bumps the template's usage counter so the gallery can sort by it.
  template_id: z.string().uuid().nullish(),
});

export class CreateInvoiceDto extends createZodDto(createInvoiceSchema) {}

/**
 * PATCH a draft: same fields, all optional; line_items replaces the whole list.
 * An issued or paid document can be edited only with `edit_reason`, which
 * goes to the audit log next to the changed fields.
 */
export const updateInvoiceSchema = invoiceFieldsSchema.partial().extend({
  edit_reason: z.string().trim().max(1000).nullish(),
});

export class UpdateInvoiceDto extends createZodDto(updateInvoiceSchema) {}

export const convertInvoiceSchema = z.object({
  to: z.enum(["invoice", "credit_note", "proforma"]),
});

export class ConvertInvoiceDto extends createZodDto(convertInvoiceSchema) {}

export const listInvoicesQuerySchema = z.object({
  type: z.enum(["invoice", "proforma", "credit_note", "quote"]).optional(),
  status: z.enum(["draft", "pending_review", "issued", "paid", "cancelled", "overdue"]).optional(),
  contact_id: z.string().uuid().optional(),
  // Customer colour label (contacts.color).
  contact_color: z.string().regex(/^[a-z]{3,10}$/).optional(),
  q: z.string().trim().max(100).optional(),
  payment_method: z.enum(["bank_transfer", "cash", "card", "cash_on_delivery", "other"]).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  // Date range (inclusive, YYYY-MM-DD) applied to the chosen date column.
  date_field: z.enum(["issue", "due", "paid", "taxable", "sent", "created"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // "no" = never e-mailed from the app, "yes" = sent at least once.
  sent: z.enum(["yes", "no"]).optional(),
  // "yes" = the customer opened the online invoice at least once.
  viewed: z.enum(["yes", "no"]).optional(),
  // Total with VAT, in the document's own currency.
  amount_min: z.coerce.number().min(0).optional(),
  amount_max: z.coerce.number().min(0).optional(),
  // How it was created: "ai" covers every AI channel (Telegram, WhatsApp).
  source: z.enum(["manual", "ai", "api", "recurring", "import", "profile_order"]).optional(),
  language: z.enum(["cs", "sk", "en"]).optional(),
  reverse_charge: z.enum(["yes", "no"]).optional(),
  // At least one line item with this VAT rate (percent).
  vat_rate: z.coerce.number().min(0).max(100).optional(),
  // unpaid = nothing received yet, partial = some but not all, full = paid.
  paid_state: z.enum(["unpaid", "partial", "full"]).optional(),
  // Issued and past due by at least this many days.
  overdue_days: z.coerce.number().int().min(1).max(3650).optional(),
  reminded: z.enum(["yes", "no"]).optional(),
  attachments: z.enum(["yes", "no"]).optional(),
  internal_note: z.enum(["yes", "no"]).optional(),
  // A quote's customer response from the online link.
  client_response: z.enum(["accepted", "rejected", "none"]).optional(),
  bank_account_id: z.string().uuid().optional(),
  // Text in a line item's description or code.
  item: z.string().trim().max(100).optional(),
  // Text in the internal note, the notes above/below the items or the customer's quote reply.
  note: z.string().trim().max(100).optional(),
  // Variable, constant or specific symbol (substring).
  symbol: z.string().trim().regex(/^[0-9]{1,10}$/).optional(),
  order_number: z.string().trim().max(60).optional(),
  // Label or value of a custom header field.
  custom_field: z.string().trim().max(100).optional(),
  // Team member who issued the document.
  issued_by: z.string().uuid().optional(),
  // Customer's country (ISO 3166-1 alpha-2); "foreign" = anything but CZ/SK.
  country: z.string().regex(/^([A-Z]{2}|foreign)$/).optional(),
  // Flagged for review (AI drafts with low confidence etc.).
  needs_attention: z.enum(["yes", "no"]).optional(),
  // Linked to another document (credit note ↔ invoice, proforma → invoice, quote → invoice).
  related: z.enum(["yes", "no"]).optional(),
  // Has at least one custom header field.
  has_custom_fields: z.enum(["yes", "no"]).optional(),
  // Total without VAT, in the document's own currency.
  net_min: z.coerce.number().min(0).optional(),
  net_max: z.coerce.number().min(0).optional(),
  // Amount still left to pay.
  due_min: z.coerce.number().min(0).optional(),
});

export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
