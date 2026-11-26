import { sharesSchema, type TaxModel } from "../net-income/tax-model";

/** Only these count in "Po zdanění", so only they belong to a partner (as on the invoice detail). */
const SPLIT_TYPES = new Set(["invoice", "credit_note"]);

/**
 * Whether `partnerId` gets a part of this document: its own split when it has
 * one, the company's default shares otherwise. A stored split that no longer
 * parses counts as the defaults, the same as the report.
 */
export function belongsToPartner(
  doc: { documentType: string; partnerShares: unknown },
  partners: TaxModel["partners"],
  partnerId: string,
): boolean {
  if (!SPLIT_TYPES.has(doc.documentType)) return false;
  const own = sharesSchema.safeParse(doc.partnerShares);
  const weight = own.success ? own.data[partnerId] : partners.find((p) => p.id === partnerId)?.share;
  return (weight ?? 0) > 0;
}
