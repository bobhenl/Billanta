import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** `POST /api/v1/me/tenants` — another company for the signed-in user. */
export const createTenantSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  /** Terms version accepted for the new company (same as at signup). */
  tosVersion: z.string().trim().min(1).max(32),
});

export class CreateTenantDto extends createZodDto(createTenantSchema) {}
