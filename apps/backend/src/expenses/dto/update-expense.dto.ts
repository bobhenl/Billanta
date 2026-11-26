import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { createExpenseSchema } from "./create-expense.dto";

/**
 * Body for `PATCH /api/v1/expenses/:id` — every field from
 * `CreateExpenseDto` made optional (partial update), same convention as a
 * typical Nest `PartialType(Create...Dto)` but expressed via Zod's
 * `.partial()` since this codebase's DTOs are Zod-schema-first
 * (`createZodDto`), not class-validator-first.
 */
export const updateExpenseSchema = createExpenseSchema.partial().extend({
  // The expense form sends false: a rule-made expense counts as checked once a person saved it.
  needsReview: z.boolean().optional(),
});

export class UpdateExpenseDto extends createZodDto(updateExpenseSchema) {}
