/**
 * Whether the Peppol pre-flight is worth showing for a buyer. Peppol is
 * business-to-business: a consumer, or a foreign buyer with no company id at
 * all (a PayPal client known only by an e-mail), will never receive an
 * e-invoice, so its warnings are noise. A Slovak buyer still gets the check
 * without a DIČ, since adding the DIČ is exactly what the warning asks for.
 */
export function peppolRelevant(buyer: {
  addressCountry: string | null;
  isPerson: boolean;
  ico: string | null;
  dic: string | null;
}): boolean {
  if (buyer.addressCountry === "CZ" || buyer.isPerson) return false;
  return buyer.addressCountry === "SK" || !!buyer.ico?.trim() || !!buyer.dic?.trim();
}
