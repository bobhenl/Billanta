import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Line-item shape mirrors `src/invoices/dto/create-invoice-draft.dto.ts`'s
 * `lineItemSchema` (camelCase here rather than that DTO's snake_case, since
 * this endpoint has no external non-TS caller to match — unlike the AI
 * microservice contract that DTO documents). Persisted verbatim as
 * `recurringInvoiceTemplates.lineItemsSnapshot` jsonb (drizzle/schema.ts);
 * copied into real `invoice_line_items` rows by
 * `RecurringInvoiceGenerationService` when a template comes due.
 */
const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().positive().default(1),
  unitPrice: z.coerce.number().nonnegative(),
  // null/undefined = no VAT rate captured yet — same "never silently
  // defaulted" convention as the AI-draft line items.
  vatRate: z.coerce.number().min(0).max(100).nullish(),
});

// Kept as a literal tuple (not `schema.recurringFrequencyEnum.enumValues`)
// so this DTO has no import-time dependency on drizzle/schema.ts; must stay
// in sync with the `recurring_frequency` Postgres enum there.
export const createRecurringInvoiceSchema = z.object({
  contactId: z.string().uuid(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  intervalCount: z.coerce.number().int().positive().default(1),
  // Optional: the service defaults this to "today" (UTC) when omitted, so a
  // template can be created to start generating immediately without the
  // caller having to compute an initial date.
  nextRunDate: z.coerce.date().optional(),
  currency: z.string().length(3).default("CZK"),
  lineItems: z.array(lineItemSchema).min(1),
});

export class CreateRecurringInvoiceDto extends createZodDto(createRecurringInvoiceSchema) {}
