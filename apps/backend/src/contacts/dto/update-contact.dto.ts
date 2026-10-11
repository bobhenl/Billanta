import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { createContactSchema } from "./create-contact.dto";

/**
 * Body for `PATCH /api/v1/contacts/:id` — every create field optional, and
 * the optional ones may be cleared with `null`. `aresVerified: true` stamps
 * a fresh `aresVerifiedAt` (the client just re-fetched the company from
 * ARES); `false` clears it.
 */
export const updateContactSchema = createContactSchema
  .extend({
    ico: z.string().regex(/^\d{8}$/, "IČO must be 8 digits").nullish(),
    dic: z.string().nullish(),
    email: z.string().email().nullish(),
  })
  .partial();

export class UpdateContactDto extends createZodDto(updateContactSchema) {}
