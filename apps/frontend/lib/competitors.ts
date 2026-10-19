/**
 * The /compare table: Billanta next to the CZ/SK invoicing apps people
 * usually switch from. Brand names are fixed; every cell's wording lives
 * in `comparePage.rows.<row>.<brand>` so it can be translated.
 *
 * Two markets, picked by the locale: `sk` compares the Slovak editions
 * (prices in euro, .sk price lists, the apps Slovaks switch from), `cs` and
 * `en` the Czech ones. The cells in each message file describe that
 * locale's market; the SK-only brands and rows exist in all three files so
 * the shapes match, but are only rendered on `sk`.
 *
 * Competitor cells come from each vendor's own public price list
 * (`pricingUrl`) as of COMPARED_AT; re-read those pages before changing
 * the date (SK research notes: docs/research/sk-competitors.md). Billanta's
 * cells follow lib/plans.ts. A feature a price list does not mention says
 * "–" (not stated) rather than claiming it is missing. Free-plan limits all
 * say "odběratelé" (customers), whatever word the vendor uses ("kontakty",
 * "odběratelé"), so the row reads as one comparison. BitFaktura's free Micro
 * plan: the plan card says 1 invoice a month (the comparison table on the
 * same page says 0-3); we show 1, which a user's own account also confirmed.
 */
export const COMPARED_AT = '2026-10';

export type Market = 'cz' | 'sk';

export const marketOf = (locale: string): Market => (locale === 'sk' ? 'sk' : 'cz');

/** Locales whose pages show this market (for hreflang and the sitemap). */
const MARKET_LOCALES: Record<Market, readonly string[]> = { cz: ['cs', 'en'], sk: ['sk'] };

const BRAND_DATA = {
  billanta: { name: 'Billanta', pricingUrl: {} },
  fakturoid: { name: 'Fakturoid', pricingUrl: { cz: 'https://www.fakturoid.cz/cenik', sk: 'https://www.fakturoid.cz/cenik' } },
  idoklad: { name: 'iDoklad', pricingUrl: { cz: 'https://www.idoklad.cz/cenik', sk: 'https://www.idoklad.sk/cennik' } },
  superfaktura: {
    name: 'SuperFaktura',
    nameSk: 'SuperFaktúra',
    pricingUrl: { cz: 'https://www.superfaktura.cz/cenik/', sk: 'https://www.superfaktura.sk/cennik/' }
  },
  vyfakturuj: { name: 'Vyfakturuj', pricingUrl: { cz: 'https://www.vyfakturuj.cz/cenik/' } },
  bitfaktura: { name: 'BitFaktura', pricingUrl: { cz: 'https://www.bitfaktura.cz/cenik' } },
  kros: { name: 'KROS Fakturácia', pricingUrl: { sk: 'https://www.kros.sk/fakturacia/cennik/' } },
  billdu: { name: 'Billdu', pricingUrl: { sk: 'https://www.billdu.com/sk/cennik/' } }
} satisfies Record<string, { name: string; nameSk?: string; pricingUrl: Partial<Record<Market, string>> }>;

export type BrandKey = keyof typeof BRAND_DATA;

/** Column order per market; Billanta first. */
const MARKET_BRANDS: Record<Market, readonly BrandKey[]> = {
  cz: ['billanta', 'fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj', 'bitfaktura'],
  sk: ['billanta', 'superfaktura', 'kros', 'idoklad', 'billdu', 'fakturoid']
};

export type Brand = { key: BrandKey; name: string; pricingUrl: string | null };

/** The table's columns for this locale's market, Billanta first. */
export function brandsFor(locale: string): Brand[] {
  const market = marketOf(locale);
  return MARKET_BRANDS[market].map((key) => {
    const data: { name: string; nameSk?: string; pricingUrl: Partial<Record<Market, string>> } = BRAND_DATA[key];
    return { key, name: (market === 'sk' && data.nameSk) || data.name, pricingUrl: data.pricingUrl[market] ?? null };
  });
}

/** The brands with their own /compare/<key> page in this locale; the key doubles as the slug. */
export const comparedBrandsFor = (locale: string) => brandsFor(locale).filter((b) => b.key !== 'billanta');

export function getComparedBrand(locale: string, slug: string) {
  return comparedBrandsFor(locale).find((b) => b.key === slug);
}

/** Every /compare/<key> page with the locales it exists in. */
export function comparedPages(): { key: BrandKey; locales: string[] }[] {
  const keys = new Set([...MARKET_BRANDS.cz, ...MARKET_BRANDS.sk].filter((k) => k !== 'billanta'));
  return [...keys].map((key) => ({
    key,
    locales: (Object.keys(MARKET_BRANDS) as Market[]).filter((m) => MARKET_BRANDS[m].includes(key)).flatMap((m) => MARKET_LOCALES[m])
  }));
}

type Row = { key: string; good: Partial<Record<Market, BrandKey[]>> };

/**
 * Row keys in display order. `good` marks, per market, the brands that come
 * out best on the row (highlighted); a row without a market's entry is not
 * shown there.
 */
const ROWS: Row[] = [
  { key: 'free', good: { cz: ['billanta'], sk: ['billanta'] } },
  { key: 'entry', good: { cz: ['billanta'], sk: ['billanta', 'superfaktura', 'billdu'] } },
  { key: 'bank', good: { cz: ['billanta', 'superfaktura', 'vyfakturuj'], sk: ['billanta', 'superfaktura', 'kros'] } },
  { key: 'ai', good: { cz: ['billanta'], sk: ['billanta'] } },
  { key: 'voice', good: { cz: ['billanta'], sk: ['billanta'] } },
  { key: 'taxEstimate', good: { cz: ['billanta', 'fakturoid'], sk: ['billanta', 'kros'] } },
  { key: 'import', good: { cz: ['billanta', 'vyfakturuj'], sk: ['billanta'] } },
  { key: 'api', good: { cz: ['fakturoid', 'bitfaktura'], sk: ['fakturoid'] } },
  { key: 'recurring', good: { cz: ['billanta'], sk: ['billanta'] } },
  { key: 'reminders', good: { cz: ['billanta', 'bitfaktura'], sk: ['billanta', 'kros'] } },
  // CZ: ISDOC and UBL files. SK: delivery over Peppol, mandatory between VAT payers from 2027;
  // only a live service counts, an announced one does not.
  { key: 'einvoice', good: { cz: ['billanta'], sk: ['superfaktura'] } },
  { key: 'vatReports', good: { sk: ['billanta'] } },
  { key: 'qr', good: { cz: ['billanta', 'fakturoid', 'vyfakturuj'], sk: ['billanta', 'superfaktura', 'kros', 'fakturoid'] } },
  { key: 'currencies', good: { cz: ['billanta', 'idoklad', 'vyfakturuj', 'bitfaktura'], sk: ['billanta', 'kros', 'idoklad'] } },
  { key: 'czsk', good: { cz: ['billanta'], sk: ['billanta'] } },
  { key: 'mobile', good: { cz: ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj'], sk: ['superfaktura', 'idoklad', 'billdu', 'fakturoid'] } },
  { key: 'history', good: { cz: ['billanta', 'bitfaktura'], sk: ['billanta'] } }
];

/** The rows shown in this locale's market; `key` is the message key under `comparePage.rows`. */
export function rowsFor(locale: string): { key: string; good: BrandKey[] }[] {
  const market = marketOf(locale);
  return ROWS.flatMap((r) => {
    const good = r.good[market];
    return good ? [{ key: r.key, good }] : [];
  });
}

/** The homepage teaser: the rows people ask about first, out of the same data. */
export const TEASER_ROW_KEYS = ['free', 'entry', 'ai', 'bank', 'taxEstimate', 'import', 'recurring'] as const;

/** "říjen 2026" for the "verified" note; mid-month so no time zone tips it into the previous month. */
export function comparedAtLabel(locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(`${COMPARED_AT}-15T12:00:00Z`));
}

/** A brand's name as this locale's market writes it (SuperFaktúra in Slovak). */
export function brandName(key: BrandKey, locale: string): string {
  const data: { name: string; nameSk?: string } = BRAND_DATA[key];
  return (marketOf(locale) === 'sk' && data.nameSk) || data.name;
}
