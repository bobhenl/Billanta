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

const recordScope = z.enum(["all", "edit_own", "own"]);

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "accountant", "viewer"]),
  permissions: permissionsSchema.nullable().optional(),
  // What the member sees and edits per area (all | edit_own | own). Owner only (TeamService).
  scopes: z
    .object({ contacts: recordScope.optional(), invoices: recordScope.optional(), expenses: recordScope.optional() })
    .optional(),
  // The clients' scope alone, as sent before 0122; `scopes.contacts` wins.
  contactScope: recordScope.optional(),
});

export class UpdateMemberDto extends createZodDto(updateMemberSchema) {}
