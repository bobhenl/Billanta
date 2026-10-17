/**
 * VAT registration of the issuing company:
 * - `payer` – plátce DPH (CZ) / platiteľ DPH (SK).
 * - `identified` – identifikovaná osoba (§6g–6l ZDPH) / registrovaný podľa §7a ZoDPH:
 *   not a payer, but registered for VAT because of services bought from or sold to
 *   other EU countries (pays the VAT on e.g. foreign ads, files souhrnné hlášení).
 * - `non_payer` – neplátce / neplatiteľ.
 */
export const VAT_STATUSES = ['payer', 'identified', 'non_payer'] as const;
export type VatStatus = (typeof VAT_STATUSES)[number];

export const isVatStatus = (v: unknown): v is VatStatus => typeof v === 'string' && (VAT_STATUSES as readonly string[]).includes(v);

/** The legacy boolean (`dic_vat_payer`) for a status: only a payer charges VAT. */
export const vatPayerOf = (status: VatStatus) => status === 'payer';

/** EU member states for services (VIES prefixes; Greece is EL, GR accepted too). Northern Ireland (XI) counts for goods only. */
export const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

const normCountry = (c: string | undefined) => {
  const u = (c ?? '').trim().toUpperCase();
  return u === 'GR' ? 'EL' : u;
};

export const isEuCountry = (c: string | undefined) => (EU_COUNTRIES as readonly string[]).includes(normCountry(c));

/**
 * Who the buyer is, for the VAT rules:
 * - `person` – a private individual (flagged so, or no IČO and no DIČ at all),
 * - `domestic_business` – a business in the supplier's own country,
 * - `eu_business` – a business in another EU member state (a taxable person there),
 * - `foreign_business` – a business outside the EU (UK, US …).
 */
export type BuyerKind = 'person' | 'domestic_business' | 'eu_business' | 'foreign_business';

/** The buyer fields the VAT rules look at (an `IsdocParty` fits). */
export interface BuyerLike {
  ico?: string;
  dic?: string;
  isPerson?: boolean;
  address?: { countryCode?: string };
}

export function buyerKind(supplierCountry: string | undefined, customer: BuyerLike): BuyerKind {
  const blank = (v: string | undefined) => !v?.trim();
  if (customer.isPerson === true || (customer.isPerson === undefined && blank(customer.ico) && blank(customer.dic))) return 'person';
  const own = normCountry(supplierCountry) || 'CZ';
  const country = normCountry(customer.address?.countryCode) || own;
  if (country === own) return 'domestic_business';
  return isEuCountry(country) ? 'eu_business' : 'foreign_business';
}

/**
 * Whether the document is a service to a business in another EU state, where
 * the customer accounts for the VAT ("daň odvede zákazník", §29/2c ZDPH,
 * art. 196 of Directive 2006/112/EC). For an identified person this is the one
 * case that needs a tax document at all.
 */
export const isEuReverseChargeService = (
  status: VatStatus,
  supplierCountry: string | undefined,
  customer: BuyerLike | undefined
) => status !== 'non_payer' && !!customer && buyerKind(supplierCountry, customer) === 'eu_business';
