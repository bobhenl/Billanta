import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { permissionsSchema } from "../../tenancy/permissions";

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  // Owner is never invitable: a tenant has exactly one, set at signup.
  role: z.enum(["admin", "accountant", "viewer"]).default("accountant"),
  // Per-area overrides of the role's defaults (presets like "Fakturant").
  permissions: permissionsSchema.nullable().optional(),
});

export class CreateInvitationDto extends createZodDto(createInvitationSchema) {}

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "accountant", "viewer"]),
  permissions: permissionsSchema.nullable().optional(),
});

export class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
