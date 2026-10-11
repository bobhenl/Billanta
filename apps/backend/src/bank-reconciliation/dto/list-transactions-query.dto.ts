import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Query params for `GET /api/v1/bank-reconciliation/transactions` — an
 * optional status filter matching `bank_transaction_status` (drizzle/schema.ts). */
export const listBankTransactionsQuerySchema = z.object({
  status: z.enum(["unmatched", "matched", "ignored"]).optional(),
});

export class ListBankTransactionsQueryDto extends createZodDto(listBankTransactionsQuerySchema) {}
