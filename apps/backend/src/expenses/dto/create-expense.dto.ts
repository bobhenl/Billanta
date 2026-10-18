import { createZodDto } from "nestjs-zod";
import { REVERSE_CHARGE_CODE_VALUES } from "@faktur/cz-compliance";
import { z } from "zod";

/**
 * Body for `POST /api/v1/expenses` — records an incoming invoice/cost
 * (blueprint §4 `expenses` table). Mirrors the shape of `create-contact.dto.ts`
 * / `create-invoice-draft.dto.ts` in sibling modules: a thin Zod schema
 * wrapped via `createZodDto`, validated by `nestjs-zod`'s global pipe.
 *
 * `tenantId` is deliberately NOT a field here, same reasoning as
 * `CreateContactDto` — it's taken from the verified request context
 * (`req.user.tenantId`) in the controller, never from client input.
 */
export const createExpenseSchema = z.object({
  // Nullable/optional: not every expense is matched to an existing contact
  // record — see the long comment on `expenses.supplierContactId` in
  // `drizzle/schema.ts`. `supplierNameRaw` is the fallback identifier.
  supplierContactId: z.string().uuid().nullish(),
  supplierNameRaw: z.string().min(1).nullish(),
  description: z.string().min(1),
  amount: z.coerce.number().nonnegative(),
  vatRate: z.coerce.number().min(0).max(100),
  currency: z.string().length(3).default("CZK"),
  // Accepts an ISO date string (or anything `Date` can parse) and coerces to
  // a real `Date`, matching the `expenseDate` column's `mode: "date"`
  // timestamp type.
  expenseDate: z.coerce.date(),
  category: z.string().min(1).nullish(),
  // Plain text URL/path for now — no upload pipeline exists yet.
  // TODO: once object storage (Backblaze B2 / Hetzner Object Storage, per
  // blueprint §2) is wired up, this should be populated by a dedicated
  // upload endpoint/flow instead of being accepted as free-text client
  // input, and probably validated as a URL pointing at that storage bucket.
  receiptFileUrl: z.string().min(1).nullish(),
  // Details printed on the received invoice (typed in or read by AI).
  documentNumber: z.string().max(64).nullish(),
  variableSymbol: z.string().regex(/^\d{1,10}$/).nullish(),
  supplierIco: z.string().regex(/^\d{8}$/).nullish(),
  supplierDic: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}[0-9A-Z]{2,12}$/)
    .nullish(),
  // Domestic reverse charge (§92a ZDPH): `amount` is then the net and
  // `vatRate` the rate the company self-assesses (KH B.1, DPHDP3 ř. 10/11).
  reverseCharge: z.boolean().optional(),
  reverseChargeCode: z.enum(REVERSE_CHARGE_CODE_VALUES).nullish(),
  dueDate: z.coerce.date().nullish(),
  paidAt: z.coerce.date().nullish(),
  note: z.string().max(2000).nullish(),
});

export class CreateExpenseDto extends createZodDto(createExpenseSchema) {}
