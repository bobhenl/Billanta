import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const invoiceSuggestionSchema = z.object({
  text: z.string().trim().min(3).max(4000),
  /** From an encrypted document, sent once with the member's consent: never stored or logged. */
  confidential: z.boolean().optional(),
});

export class InvoiceSuggestionDto extends createZodDto(invoiceSuggestionSchema) {}
