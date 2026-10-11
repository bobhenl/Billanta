import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const invoiceSuggestionSchema = z.object({
  text: z.string().trim().min(3).max(4000),
});

export class InvoiceSuggestionDto extends createZodDto(invoiceSuggestionSchema) {}
