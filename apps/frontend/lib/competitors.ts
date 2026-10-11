/**
 * The /srovnani table: Billanta next to the CZ/SK invoicing apps people
 * usually switch from. Brand names are fixed; every cell's wording lives
 * in `comparePage.rows.<row>.<brand>` so it can be translated.
 *
 * Figures come from the public price lists as of COMPARED_AT and are
 * approximate on purpose (the page says so). Re-check them before
 * changing the date. A row we could not verify for a competitor says
 * "not stated" rather than claiming the feature is missing.
 */
export const COMPARED_AT = '2026-10';

export const BRANDS = [
  { key: 'billanta', name: 'Billanta' },
  { key: 'fakturoid', name: 'Fakturoid' },
  { key: 'idoklad', name: 'iDoklad' },
  { key: 'superfaktura', name: 'SuperFaktura' },
  { key: 'vyfakturuj', name: 'Vyfakturuj' },
  { key: 'bitfaktura', name: 'bitfaktura' }
] as const;

export type BrandKey = (typeof BRANDS)[number]['key'];

/** Row keys in display order. `good` marks brands that come out best on the row (highlighted). */
export const COMPETITOR_ROWS: { key: string; good: BrandKey[] }[] = [
  { key: 'free', good: ['billanta'] },
  { key: 'entry', good: ['billanta'] },
  { key: 'bank', good: ['billanta', 'superfaktura', 'vyfakturuj', 'bitfaktura'] },
  { key: 'ai', good: ['billanta'] },
  { key: 'voice', good: ['billanta'] },
  { key: 'api', good: ['fakturoid', 'bitfaktura'] },
  { key: 'recurring', good: ['billanta', 'idoklad', 'vyfakturuj', 'bitfaktura'] },
  { key: 'reminders', good: ['billanta', 'fakturoid', 'idoklad', 'vyfakturuj'] },
  { key: 'einvoice', good: ['billanta'] },
  { key: 'czsk', good: ['billanta'] },
  { key: 'mobile', good: ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj'] },
  { key: 'history', good: ['billanta', 'bitfaktura'] }
];
