import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const claimReferralSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{4,12}$/),
});
export class ClaimReferralDto extends createZodDto(claimReferralSchema) {}

export const referralProgramSchema = z.object({
  program: z.enum(["friend", "accountant"]),
});
export class ReferralProgramDto extends createZodDto(referralProgramSchema) {}

export const redeemCreditsSchema = z.object({
  plan: z.enum(["start", "plus", "business"]),
  months: z.union([z.literal(1), z.literal(12)]),
});
export class RedeemCreditsDto extends createZodDto(redeemCreditsSchema) {}
