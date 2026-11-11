import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * The terms text new companies accept. Same value as `TOS_VERSION` in
 * apps/frontend/lib/tos.ts (create-tenant.dto.spec.ts checks it). Pinned
 * because `bootstrap_tenant_for_user` creates the `tos_versions` row for a
 * version it hasn't seen, which would log acceptance of terms never published.
 */
export const CURRENT_TOS_VERSION = "1.0.0";

/** `POST /api/v1/me/tenants` — another company for the signed-in user. */
export const createTenantSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  /** Terms version accepted for the new company (same as at signup). */
  tosVersion: z.literal(CURRENT_TOS_VERSION),
});

export class CreateTenantDto extends createZodDto(createTenantSchema) {}
