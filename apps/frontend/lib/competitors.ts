/**
 * The /compare table: Billanta next to the CZ/SK invoicing apps people
 * usually switch from. Brand names are fixed; every cell's wording lives
 * in `comparePage.rows.<row>.<brand>` so it can be translated.
 *
 * Competitor cells come from each vendor's own public price list
 * (`pricingUrl`) as of COMPARED_AT; re-read those pages before changing
 * the date. Billanta's cells follow lib/plans.ts. A feature a price list
 * does not mention says "–" (not stated) rather than claiming it is
 * missing. Free-plan limits all say "odběratelé" (customers), whatever
 * word the vendor uses ("kontakty", "odběratelé"), so the row reads as one
 * comparison. BitFaktura's free Micro plan: the plan card says 1 invoice a
 * month (the comparison table on the same page says 0-3); we show 1, which
 * a user's own account also confirmed.
 */
export const COMPARED_AT = '2026-10';

export const BRANDS = [
  { key: 'billanta', name: 'Billanta', pricingUrl: null },
  { key: 'fakturoid', name: 'Fakturoid', pricingUrl: 'https://www.fakturoid.cz/cenik' },
  { key: 'idoklad', name: 'iDoklad', pricingUrl: 'https://www.idoklad.cz/cenik' },
  { key: 'superfaktura', name: 'SuperFaktura', pricingUrl: 'https://www.superfaktura.cz/cenik/' },
  { key: 'vyfakturuj', name: 'Vyfakturuj', pricingUrl: 'https://www.vyfakturuj.cz/cenik/' },
  { key: 'bitfaktura', name: 'BitFaktura', pricingUrl: 'https://www.bitfaktura.cz/cenik' }
] as const;

export type BrandKey = (typeof BRANDS)[number]['key'];

/** The brands with their own /compare/<key> page; the key doubles as the slug. */
export const COMPARED_BRANDS = BRANDS.filter((b) => b.key !== 'billanta');

export function getComparedBrand(slug: string) {
  return COMPARED_BRANDS.find((b) => b.key === slug);
}

/** Row keys in display order. `good` marks brands that come out best on the row (highlighted). */
export const COMPETITOR_ROWS: { key: string; good: BrandKey[] }[] = [
  { key: 'free', good: ['billanta'] },
  { key: 'entry', good: ['billanta'] },
  { key: 'bank', good: ['billanta', 'superfaktura', 'vyfakturuj'] },
  { key: 'ai', good: ['billanta'] },
  { key: 'voice', good: ['billanta'] },
  { key: 'taxEstimate', good: ['billanta', 'fakturoid'] },
  { key: 'import', good: ['billanta', 'vyfakturuj'] },
  { key: 'api', good: ['fakturoid', 'bitfaktura'] },
  { key: 'recurring', good: ['billanta'] },
  { key: 'reminders', good: ['billanta', 'bitfaktura'] },
  { key: 'einvoice', good: ['billanta'] },
  { key: 'qr', good: ['billanta', 'fakturoid', 'vyfakturuj'] },
  { key: 'currencies', good: ['billanta', 'idoklad', 'vyfakturuj', 'bitfaktura'] },
  { key: 'czsk', good: ['billanta'] },
  { key: 'mobile', good: ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj'] },
  { key: 'history', good: ['billanta', 'bitfaktura'] }
];

/** The homepage teaser: the rows people ask about first, out of the same data. */
export const TEASER_ROW_KEYS = ['free', 'entry', 'ai', 'bank', 'taxEstimate', 'import', 'recurring'] as const;

/** "říjen 2026" for the "verified" note; mid-month so no time zone tips it into the previous month. */
export function comparedAtLabel(locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${COMPARED_AT}-15T12:00:00Z`));
}
