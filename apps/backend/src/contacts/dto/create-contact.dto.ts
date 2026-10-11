import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const createContactSchema = z.object({
  legalName: z.string().min(1),
  ico: z
    .string()
    .regex(/^\d{8}$/, "IČO must be 8 digits")
    .optional(),
  dic: z.string().optional(),
  // Optional: without it, this contact simply can't be emailed yet (see the
  // long comment on `contacts.email` in drizzle/schema.ts) — invoice-sending
  // and overdue-reminder emails check for this explicitly rather than
  // assuming it's set.
  email: z.string().email().optional(),
});

export class CreateContactDto extends createZodDto(createContactSchema) {}
