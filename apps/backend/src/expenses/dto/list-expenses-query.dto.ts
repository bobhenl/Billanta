import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Query params for `GET /api/v1/expenses` — simple offset pagination.
 * `page` is 1-indexed; `limit` is capped at 100 to keep an unbounded
 * `?limit=999999` from turning into an accidental full-table scan.
 */
export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListExpensesQueryDto extends createZodDto(listExpensesQuerySchema) {}
