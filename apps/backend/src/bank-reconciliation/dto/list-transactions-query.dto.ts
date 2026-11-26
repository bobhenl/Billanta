import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Query params for `GET /api/v1/bank-reconciliation/transactions` — an
 * optional status filter matching `bank_transaction_status` (drizzle/schema.ts),
 * and the invoice a payment was matched to (the invoice detail shows it). */
export const listBankTransactionsQuerySchema = z.object({
  status: z.enum(["unmatched", "matched", "ignored"]).optional(),
  invoiceId: z.string().uuid().optional(),
});

export class ListBankTransactionsQueryDto extends createZodDto(listBankTransactionsQuerySchema) {}
