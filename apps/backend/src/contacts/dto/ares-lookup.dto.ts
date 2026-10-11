import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body for `POST /api/v1/contacts/ares-lookup`. `apps/ai-service`'s
 * `enrich_with_ares()` already calls this exact path expecting an IČO in,
 * subject data out (see `contacts.controller.ts`'s doc comment on
 * `aresLookup`) — this DTO is deliberately just `{ ico }`, matching that
 * caller's own request body, not a hypothetical richer shape.
 */
export const aresLookupSchema = z.object({
  ico: z.string().regex(/^\d{8}$/, "IČO must be 8 digits"),
});

export class AresLookupDto extends createZodDto(aresLookupSchema) {}
