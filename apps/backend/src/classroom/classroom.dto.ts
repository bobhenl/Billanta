import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { DEMO_KINDS } from "../demo/dataset";
import { enabledModulesSchema } from "../tenants/modules";
import { ACCOUNTANT_MODES } from "./accountants";
import { CLASSROOM_TRACKS, SCHOOL_LEVELS } from "./tracks";

const text = (max: number) => z.string().trim().min(1).max(max);

export const applySchema = z.object({
  country: z.enum(["CZ", "SK"]),
  ico: z.string().trim().regex(/^\d{6,8}$/),
  schoolName: text(200),
  level: z.enum(SCHOOL_LEVELS),
  legalForm: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  webUrl: z.string().trim().max(300).optional(),
  name: text(120),
  subject: z.string().trim().max(120).optional(),
  expectedStudents: z.number().int().min(1).max(2000).optional(),
  acceptTerms: z.literal(true),
});
export class ApplyDto extends createZodDto(applySchema) {}

export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
export class InviteDto extends createZodDto(inviteSchema) {}

export const createClassSchema = z.object({
  name: text(80),
  track: z.enum(CLASSROOM_TRACKS),
  language: z.enum(["cs", "sk", "en"]),
  kinds: z.array(z.enum(DEMO_KINDS)).min(1).optional(),
  modules: enabledModulesSchema.optional(),
  // false = empty companies, for lessons that start from nothing.
  seeded: z.boolean().optional(),
  endsAt: z.coerce.date().optional(),
});
export class CreateClassDto extends createZodDto(createClassSchema) {}

export const updateClassSchema = z.object({
  name: text(80).optional(),
  enrolmentOpen: z.boolean().optional(),
  kinds: z.array(z.enum(DEMO_KINDS)).min(1).optional(),
});
export class UpdateClassDto extends createZodDto(updateClassSchema) {}

export const extendClassSchema = z.object({ endsAt: z.coerce.date().optional() });
export class ExtendClassDto extends createZodDto(extendClassSchema) {}

export const coTeacherSchema = z.object({ teacherId: z.string().uuid() });
export class CoTeacherDto extends createZodDto(coTeacherSchema) {}

// Phase 2 (docs/classroom-mode-plan.md §8).
export const teamSchema = z.object({ name: text(40) });
export class TeamDto extends createZodDto(teamSchema) {}

export const teamMemberSchema = z.object({ studentId: z.string().uuid() });
export class TeamMemberDto extends createZodDto(teamMemberSchema) {}

export const createCompanySchema = z
  .object({
    studentId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    kind: z.enum(DEMO_KINDS),
    // Shown instead of the dataset's company name, so a student's two
    // companies (or a pair of the same type) can be told apart.
    label: z.string().trim().max(60).optional(),
  })
  .refine((v) => (v.studentId ? 1 : 0) + (v.teamId ? 1 : 0) === 1, { message: "classroom_company_owner" });
export class CreateCompanyDto extends createZodDto(createCompanySchema) {}

export const partnersSchema = z
  .object({ tenantA: z.string().uuid(), tenantB: z.string().uuid() })
  .refine((v) => v.tenantA !== v.tenantB, { message: "classroom_partner_same" });
export class PartnersDto extends createZodDto(partnersSchema) {}

export const accountantSchema = z.object({
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  mode: z.enum(ACCOUNTANT_MODES).default("bookkeeper"),
});
export class AccountantDto extends createZodDto(accountantSchema) {}

export const decisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional(),
  // Staff confirm the school's mail domain, which turns on the fast path for colleagues.
  emailDomain: z.string().trim().toLowerCase().max(200).optional(),
});
export class DecisionDto extends createZodDto(decisionSchema) {}

/** 2–30 characters: letters, digits, spaces and a little punctuation. */
const NICKNAME = /^[\p{L}\p{N}][\p{L}\p{N} .'_-]{0,28}[\p{L}\p{N}.]$/u;

export function normalizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const nick = input.normalize("NFC").trim().replace(/\s+/g, " ");
  return NICKNAME.test(nick) ? nick : null;
}
