import { createZodDto } from "nestjs-zod";
import { createExpenseSchema } from "./create-expense.dto";

/**
 * Body for `PATCH /api/v1/expenses/:id` — every field from
 * `CreateExpenseDto` made optional (partial update), same convention as a
 * typical Nest `PartialType(Create...Dto)` but expressed via Zod's
 * `.partial()` since this codebase's DTOs are Zod-schema-first
 * (`createZodDto`), not class-validator-first.
 */
export const updateExpenseSchema = createExpenseSchema.partial();

export class UpdateExpenseDto extends createZodDto(updateExpenseSchema) {}
