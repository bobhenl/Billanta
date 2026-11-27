import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { isItemPlaceholder, isSealed } from "@faktur/cz-compliance";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { CONFIDENTIAL_CONTENT, assertSealingAllowed } from "./sealed";

/*
 * Server side of the "amounts" category. A sealed document has its totals in
 * `invoices.enc_amounts` and each item's quantity, unit price, VAT rate and
 * discount in `invoice_line_items.enc_amounts`, all `enc:v1:` envelopes the
 * server cannot open. The plain columns hold the placeholder (quantity 1,
 * price 0, no rate), so every sum the server makes over a sealed document is
 * 0. That is safe, never a leak, but it is not the real number either: every
 * place that shows or reports an amount checks `amountsSealed` and either
 * leaves the document out (and says so) or refuses.
 *
 * The number, VS, dates, currency and status stay readable, so numbering,
 * bank matching by VS, reminders by due date and the paid status still work.
 */

export const AMOUNTS_SEALED = "amounts_sealed";
export const AMOUNTS_PLAINTEXT = "amounts_plaintext";

type DocAmounts = { encAmounts?: string | null };
type ItemAmountsRow = {
  encAmounts?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  vatRate?: string | number | null;
  discountPercent?: string | number | null;
};

/** The document's amounts are sealed. */
export function amountsSealed(invoice: DocAmounts | null | undefined): boolean {
  return isSealed(invoice?.encAmounts);
}

/**
 * The document and its items agree: either all sealed (and the plain columns
 * hold only the placeholder, and nothing is recorded as paid in plain) or
 * none. Anything else means the browser sent real numbers next to the
 * envelopes, or an envelope the server would then sum as 0 without knowing.
 */
export function assertAmountsShape(doc: DocAmounts & { amountPaid?: string | number | null }, items: ItemAmountsRow[]): void {
  if (doc.encAmounts != null && !isSealed(doc.encAmounts)) throw new BadRequestException(AMOUNTS_PLAINTEXT);
  if (items.some((i) => i.encAmounts != null && !isSealed(i.encAmounts))) throw new BadRequestException(AMOUNTS_PLAINTEXT);
  if (amountsSealed(doc)) {
    if (items.some((i) => !isSealed(i.encAmounts) || !isItemPlaceholder(i))) throw new BadRequestException(AMOUNTS_PLAINTEXT);
    if (Number(doc.amountPaid ?? 0) !== 0) throw new BadRequestException(AMOUNTS_PLAINTEXT);
  } else if (items.some((i) => isSealed(i.encAmounts))) {
    throw new BadRequestException(AMOUNTS_PLAINTEXT);
  }
}

/**
 * Whether a write of a document's amounts may be stored. Plain amounts over
 * sealed ones are refused (that would undo the encryption behind the user's
 * back; the browser re-seals what it edits). Sealing a plain document needs
 * the plan and the "amounts" category; a document that is sealed already
 * stays editable after a downgrade or with the category off again.
 */
export async function assertAmountsWrite(
  db: PostgresJsDatabase<typeof schema>,
  tenantId: string,
  incoming: DocAmounts & { amountPaid?: string | number | null; items: ItemAmountsRow[] },
  stored: DocAmounts | null,
): Promise<void> {
  if (amountsSealed(stored) && !amountsSealed(incoming)) throw new ConflictException(AMOUNTS_SEALED);
  assertAmountsShape(incoming, incoming.items);
  if (!amountsSealed(incoming) || amountsSealed(stored)) return;
  await assertSealingAllowed(db, tenantId, [incoming.encAmounts]);
  await assertAmountsCategory(db, tenantId);
}

type PaidColumns = { status: string; amountPaid: string | number | null; paymentFees?: string | number | null; receivedCzk?: string | number | null };

/**
 * What sealing does to the plain payment columns. The paid sum, the fees and
 * what arrived in the home currency all go: any of them gives the total
 * away. `carried` is the browser's envelope of those numbers (one payment
 * under the document key, vault-payments.ts), stored as a payment without a
 * date. A paid document keeps its status and may drop the numbers without
 * one; a partly paid one needs it, or the server could no longer tell that
 * something was paid (409 amounts_partly_paid).
 */
export function paymentsOnSeal(
  stored: PaidColumns,
  carried: string | null | undefined,
): { set: { amountPaid?: "0"; paymentFees?: "0"; receivedCzk?: null; sealedPaymentState?: "partly_paid" }; carry: string | null } {
  const paid = Number(stored.amountPaid ?? 0) !== 0;
  if (!paid && Number(stored.paymentFees ?? 0) === 0 && stored.receivedCzk == null) return { set: {}, carry: null };
  const zeroed = { amountPaid: "0" as const, paymentFees: "0" as const, receivedCzk: null };
  if (carried != null && !isSealed(carried)) throw new BadRequestException(AMOUNTS_PLAINTEXT);
  if (stored.status === "paid" || !paid) return { set: zeroed, carry: carried ?? null };
  if (!carried) throw new ConflictException("amounts_partly_paid");
  return { set: { ...zeroed, sealedPaymentState: "partly_paid" }, carry: carried };
}

/** 403 vault_category_off unless the company encrypts amounts. */
export async function assertAmountsCategory(db: PostgresJsDatabase<typeof schema>, tenantId: string): Promise<void> {
  const [vault] = await db
    .select({ categories: schema.tenantVaults.categories })
    .from(schema.tenantVaults)
    .where(eq(schema.tenantVaults.tenantId, tenantId))
    .limit(1);
  if (!vault?.categories.includes("amounts")) throw new ForbiddenException("vault_category_off");
}

/** 409 `confidential_content` for anything the server would have to print or send with the amounts. */
export function assertAmountsReadable(invoice: DocAmounts | null | undefined): void {
  if (amountsSealed(invoice)) throw new ConflictException(CONFIDENTIAL_CONTENT);
}

/** 409 `amounts_sealed`: an operation that needs the server to compute with the amounts. */
export function refuseSealedAmounts(invoice: DocAmounts | null | undefined): void {
  if (amountsSealed(invoice)) throw new ConflictException(AMOUNTS_SEALED);
}

/**
 * Splits rows for an aggregate: the plain ones the server sums, and the ids
 * of the sealed ones the browser adds itself after unlock. A sealed row
 * summed here would count as 0 and quietly understate the total.
 */
export function splitSealed<T extends DocAmounts & { id: string }>(rows: T[]): { plain: T[]; sealed: { count: number; ids: string[] } } {
  const plain: T[] = [];
  const ids: string[] = [];
  for (const r of rows) {
    if (amountsSealed(r)) ids.push(r.id);
    else plain.push(r);
  }
  return { plain, sealed: { count: ids.length, ids } };
}

/**
 * 409 `amounts_sealed` with the sealed ids, for a file the server builds in
 * one piece (a VAT return, an accountant export, a tax-return basis): leaving
 * the sealed documents out would hand over a wrong filing that looks right.
 */
export function refuseSealedRows(rows: (DocAmounts & { id: string })[]): void {
  refuseSealedSet(splitSealed(rows).sealed);
}

export function refuseSealedSet(sealed: { count: number; ids: string[] }): void {
  if (sealed.count > 0) throw new ConflictException({ message: AMOUNTS_SEALED, sealed });
}
