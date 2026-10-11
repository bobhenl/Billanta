import { createZodDto } from "nestjs-zod";
import { createRecurringInvoiceSchema } from "./create-recurring-invoice.dto";

/**
 * `PATCH /api/v1/recurring-invoices/:id` — every field optional, same shape
 * as create otherwise. Does NOT include `isActive`: (de)activation goes
 * through the dedicated `POST /:id/deactivate` endpoint instead of a
 * generic field-patch, so "soft delete" stays an explicit, auditable action
 * rather than something that can happen incidentally inside an unrelated
 * field update.
 */
export const updateRecurringInvoiceSchema = createRecurringInvoiceSchema.partial();

export class UpdateRecurringInvoiceDto extends createZodDto(updateRecurringInvoiceSchema) {}
