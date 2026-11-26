import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ruleBodySchema } from "../bank-rules";

export class BankRuleDto extends createZodDto(ruleBodySchema) {}

/** PATCH: the toggle sends only `enabled`; the rest is merged with the stored rule and checked again. */
export class UpdateBankRuleDto extends createZodDto(ruleBodySchema.partial()) {}

export class ReorderBankRulesDto extends createZodDto(z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })) {}
