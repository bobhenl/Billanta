import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Body for `POST /api/v1/api-keys` — generate a new public-API key. */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  // e.g. ['invoices:write', 'invoices:read']. Stored verbatim on the row;
  // enforcing scopes at request time is a documented TODO (see
  // ApiKeyAuthGuard) — no endpoint in this pass reads `scopes` back yet.
  scopes: z.array(z.string()).default([]),
});

export class CreateApiKeyDto extends createZodDto(createApiKeySchema) {}
