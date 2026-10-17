import * as schema from "../../drizzle/schema";

type TenantRow = typeof schema.tenants.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;

/**
 * Supplier and buyer details as they stood when a document was issued
 * (`invoices.seller_snapshot` / `buyer_snapshot`, migration 0040).
 *
 * §29 and §34–35 ZDPH: an issued tax document must keep the data valid on its
 * issue date, so a company that later moves or changes its DIČ must not
 * silently rewrite its old invoices. Every renderer (PDF, ISDOC, UBL, the
 * mandatory-content check, e-mail variables, accounting exports, the public
 * page) lays the snapshot over the live `tenants` / `contacts` row. A null
 * snapshot (drafts, and every document issued before the snapshot existed)
 * falls back to the live row, which is exactly how those were shown before.
 *
 * A snapshot may be partial (an import whose source lacked some field): only
 * keys present in it override; a key present with `null` means "known to be
 * empty on the document" and does override.
 */
export const SELLER_SNAPSHOT_KEYS = [
  "companyName",
  "legalName",
  "ico",
  "dic",
  "dicVatPayer",
  "addressStreet",
  "addressCity",
  "addressPostalCode",
  "addressCountry",
  "registryNote",
  "email",
  "phone",
  "website",
  "bankAccountNumber",
  "bankAccountBankCode",
  "bankAccountIban",
  "bankAccountSwift",
] as const satisfies readonly (keyof TenantRow)[];

export const BUYER_SNAPSHOT_KEYS = [
  "legalName",
  "ico",
  "dic",
  "isVatPayer",
  "isPerson",
  "email",
  "addressStreet",
  "addressCity",
  "addressPostalCode",
  "addressCountry",
] as const satisfies readonly (keyof ContactRow)[];

type SellerKey = (typeof SELLER_SNAPSHOT_KEYS)[number];
type BuyerKey = (typeof BUYER_SNAPSHOT_KEYS)[number];

export type SellerSnapshot = Partial<Pick<TenantRow, SellerKey>> & { capturedAt?: string; source?: "issue" | "import" | "manual_refresh" };
export type BuyerSnapshot = Partial<Pick<ContactRow, BuyerKey>> & { capturedAt?: string; source?: "issue" | "import" | "manual_refresh" };

/** Keys whose value must be a non-null string (NOT NULL columns). */
const REQUIRED_STRING = new Set<string>(["companyName", "legalName", "addressCountry"]);
const BOOLEAN_KEYS = new Set<string>(["dicVatPayer", "isVatPayer", "isPerson"]);

function pick<K extends string>(row: Record<string, unknown>, keys: readonly K[]): Record<K, unknown> {
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) as Record<K, unknown>;
}

/**
 * The supplier block of a document being issued. `tenant` must already carry
 * the bank account the document is paid to (`resolveTenantForInvoice`).
 * The logo is not copied: it is not a mandatory particular and would add up
 * to 512 kB per document.
 */
export function sellerSnapshotOf(tenant: TenantRow, capturedAt: Date = new Date(), source: SellerSnapshot["source"] = "issue"): SellerSnapshot {
  return { ...(pick(tenant, SELLER_SNAPSHOT_KEYS) as SellerSnapshot), capturedAt: capturedAt.toISOString(), source };
}

export function buyerSnapshotOf(contact: ContactRow, capturedAt: Date = new Date(), source: BuyerSnapshot["source"] = "issue"): BuyerSnapshot {
  return { ...(pick(contact, BUYER_SNAPSHOT_KEYS) as BuyerSnapshot), capturedAt: capturedAt.toISOString(), source };
}

/** The valid overriding entries of a stored snapshot (jsonb is untrusted shape-wise). */
function entriesOf(snapshot: unknown, keys: readonly string[]): [string, unknown][] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const out: [string, unknown][] = [];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) continue;
    const value = (snapshot as Record<string, unknown>)[key];
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value === "boolean" || (value === null && key !== "dicVatPayer" && key !== "isPerson")) out.push([key, value]);
    } else if (REQUIRED_STRING.has(key)) {
      if (typeof value === "string" && value.trim()) out.push([key, value]);
    } else if (value === null || typeof value === "string") {
      out.push([key, value]);
    }
  }
  return out;
}

/** The live tenant row with the document's supplier snapshot laid over it. */
export function applySellerSnapshot<T extends Partial<TenantRow>>(tenant: T, snapshot: unknown): T {
  const entries = entriesOf(snapshot, SELLER_SNAPSHOT_KEYS);
  return entries.length ? { ...tenant, ...Object.fromEntries(entries) } : tenant;
}

/** The live contact row with the document's buyer snapshot laid over it. */
export function applyBuyerSnapshot<T extends Partial<ContactRow>>(contact: T, snapshot: unknown): T {
  const entries = entriesOf(snapshot, BUYER_SNAPSHOT_KEYS);
  return entries.length ? { ...contact, ...Object.fromEntries(entries) } : contact;
}

/**
 * Both parties as printed on this document: snapshot when the document has
 * one, else the live rows. `tenant` should already be bank-resolved for the
 * fallback case; with a snapshot, its bank fields win (the account printed
 * at issue, even if that account was later removed or changed).
 */
export function documentParties<T extends Partial<TenantRow>, C extends Partial<ContactRow>>(
  invoice: Pick<InvoiceRow, "sellerSnapshot" | "buyerSnapshot">,
  tenant: T,
  contact: C,
): { tenant: T; contact: C };
export function documentParties<T extends Partial<TenantRow>, C extends Partial<ContactRow>>(
  invoice: Pick<InvoiceRow, "sellerSnapshot" | "buyerSnapshot">,
  tenant: T,
  contact: C | null | undefined,
): { tenant: T; contact: C | null };
export function documentParties<T extends Partial<TenantRow>, C extends Partial<ContactRow>>(
  invoice: Pick<InvoiceRow, "sellerSnapshot" | "buyerSnapshot">,
  tenant: T,
  contact: C | null | undefined,
): { tenant: T; contact: C | null } {
  return {
    tenant: applySellerSnapshot(tenant, invoice.sellerSnapshot),
    contact: contact ? applyBuyerSnapshot(contact, invoice.buyerSnapshot) : null,
  };
}

const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v ?? null);

/**
 * Whether the stored snapshot differs from the current details in anything
 * it records (for the "podle stavu ke dni vystavení" note). False without a snapshot.
 */
export function snapshotDiffers(snapshot: unknown, live: Record<string, unknown> | null | undefined, keys: readonly string[]): boolean {
  if (!live) return false;
  return entriesOf(snapshot, keys).some(([key, value]) => norm(value) !== norm(live[key]));
}

/** A buyer exactly as an imported source document shows it (address kept as typed). */
export function buyerSnapshotFromImport(
  customer: Partial<Record<BuyerKey, unknown>>,
  capturedAt: Date = new Date(),
): BuyerSnapshot | null {
  if (typeof customer.legalName !== "string" || !customer.legalName.trim()) return null;
  const out: Record<string, unknown> = {};
  for (const key of BUYER_SNAPSHOT_KEYS) if (customer[key] !== undefined) out[key] = customer[key];
  return { ...(out as BuyerSnapshot), capturedAt: capturedAt.toISOString(), source: "import" };
}
