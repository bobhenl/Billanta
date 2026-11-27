import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { sealableText, sealedEnvelope } from "../../vault/sealed";

const templateLineItemSchema = z.object({
  description: sealableText(500).pipe(z.string().min(1)),
  quantity: z.coerce.number().refine((n) => n !== 0, "Quantity must not be zero").default(1),
  unit: z.string().trim().max(16).nullish(),
  unit_price: z.coerce.number(),
  vat_rate: z.coerce.number().min(0).max(100).nullish(),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
});

export const invoiceTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  icon: z.string().trim().max(16).nullish(),
  contact_id: z.string().uuid().nullish(),
  document_type: z.enum(["invoice", "proforma", "credit_note", "quote"]).default("invoice"),
  currency: z.string().length(3).default("CZK"),
  due_in_days: z.coerce.number().int().min(0).max(365).nullish(),
  payment_method: z.enum(["bank_transfer", "cash", "card", "cash_on_delivery", "other"]).default("bank_transfer"),
  note_above: sealableText(2000).nullish(),
  note_below: sealableText(2000).nullish(),
  line_items: z.array(templateLineItemSchema).max(200).default([]),
});

export class CreateInvoiceTemplateDto extends createZodDto(invoiceTemplateSchema) {}

export const updateInvoiceTemplateSchema = invoiceTemplateSchema.partial();

export class UpdateInvoiceTemplateDto extends createZodDto(updateInvoiceTemplateSchema) {}

export const bulkInvoiceSchema = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(200),
  issue_date: z.coerce.date().optional(),
  // Issue every draft right away (numbers allocated in order) instead of
  // leaving them for review.
  issue: z.boolean().default(false),
  // A template with sealed amounts: the browser opened it and sealed one
  // copy per customer under that draft's own new document key (texts too).
  sealed: z
    .array(
      z.object({
        contact_id: z.string().uuid(),
        enc_amounts: sealedEnvelope(4000),
        note_above: sealableText(2000).nullish(),
        note_below: sealableText(2000).nullish(),
        line_items: z.array(z.object({ description: sealableText(500).pipe(z.string().min(1)), enc_amounts: sealedEnvelope(400) })).max(200),
      }),
    )
    .max(200)
    .optional(),
});

export class BulkInvoiceDto extends createZodDto(bulkInvoiceSchema) {}
