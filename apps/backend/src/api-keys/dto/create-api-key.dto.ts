import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { API_KEY_SCOPES } from "../api-key.util";

/** Body for `POST /api/v1/api-keys` — generate a new public-API key. */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  // `["read"]` = read-only key (safe methods only); `[]` or `["write"]` =
  // full access. Enforced per request by `apiKeyAllowsMethod`.
  scopes: z.array(z.enum(API_KEY_SCOPES)).max(API_KEY_SCOPES.length).default([]),
});

export class CreateApiKeyDto extends createZodDto(createApiKeySchema) {}
