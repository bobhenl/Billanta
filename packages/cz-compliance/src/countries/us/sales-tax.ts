import type { Source, Subdivision, TaxRateSet } from '../types.js';

export const US_STATES: readonly Subdivision[] = [
  { code: 'US-AL', name: 'Alabama' },
  { code: 'US-AK', name: 'Alaska' },
  { code: 'US-AZ', name: 'Arizona' },
  { code: 'US-AR', name: 'Arkansas' },
  { code: 'US-CA', name: 'California' },
  { code: 'US-CO', name: 'Colorado' },
  { code: 'US-CT', name: 'Connecticut' },
  { code: 'US-DE', name: 'Delaware' },
  { code: 'US-DC', name: 'District of Columbia' },
  { code: 'US-FL', name: 'Florida' },
  { code: 'US-GA', name: 'Georgia' },
  { code: 'US-HI', name: 'Hawaii' },
  { code: 'US-ID', name: 'Idaho' },
  { code: 'US-IL', name: 'Illinois' },
  { code: 'US-IN', name: 'Indiana' },
  { code: 'US-IA', name: 'Iowa' },
  { code: 'US-KS', name: 'Kansas' },
  { code: 'US-KY', name: 'Kentucky' },
  { code: 'US-LA', name: 'Louisiana' },
  { code: 'US-ME', name: 'Maine' },
  { code: 'US-MD', name: 'Maryland' },
  { code: 'US-MA', name: 'Massachusetts' },
  { code: 'US-MI', name: 'Michigan' },
  { code: 'US-MN', name: 'Minnesota' },
  { code: 'US-MS', name: 'Mississippi' },
  { code: 'US-MO', name: 'Missouri' },
  { code: 'US-MT', name: 'Montana' },
  { code: 'US-NE', name: 'Nebraska' },
  { code: 'US-NV', name: 'Nevada' },
  { code: 'US-NH', name: 'New Hampshire' },
  { code: 'US-NJ', name: 'New Jersey' },
  { code: 'US-NM', name: 'New Mexico' },
  { code: 'US-NY', name: 'New York' },
  { code: 'US-NC', name: 'North Carolina' },
  { code: 'US-ND', name: 'North Dakota' },
  { code: 'US-OH', name: 'Ohio' },
  { code: 'US-OK', name: 'Oklahoma' },
  { code: 'US-OR', name: 'Oregon' },
  { code: 'US-PA', name: 'Pennsylvania' },
  { code: 'US-RI', name: 'Rhode Island' },
  { code: 'US-SC', name: 'South Carolina' },
  { code: 'US-SD', name: 'South Dakota' },
  { code: 'US-TN', name: 'Tennessee' },
  { code: 'US-TX', name: 'Texas' },
  { code: 'US-UT', name: 'Utah' },
  { code: 'US-VT', name: 'Vermont' },
  { code: 'US-VA', name: 'Virginia' },
  { code: 'US-WA', name: 'Washington' },
  { code: 'US-WV', name: 'West Virginia' },
  { code: 'US-WI', name: 'Wisconsin' },
  { code: 'US-WY', name: 'Wyoming' },
];

/** States with no statewide general sales tax. Local taxes can still apply (Alaska boroughs, Montana resort towns). */
export const NO_STATE_SALES_TAX: ReadonlySet<string> = new Set(['US-AK', 'US-DE', 'US-MT', 'US-NH', 'US-OR']);

/**
 * State-level rate as each revenue department states its "statewide" rate.
 * County, city and district taxes come on top and are out of scope.
 * `from` is the date the current rate took effect where it was checked;
 * '2026-01-01' only means "in force on the date this table was verified".
 */
const STATE_RATES: Readonly<Record<string, { rate: number; from?: string; note?: string }>> = {
  'US-AL': { rate: 4 },
  'US-AK': { rate: 0, note: 'no state sales tax; boroughs and cities levy their own, remote sellers file through the ARSSTC' },
  'US-AZ': { rate: 5.6, note: 'transaction privilege tax, levied on the seller' },
  'US-AR': { rate: 6.5 },
  'US-CA': { rate: 7.25, note: 'includes the 1.25% local share that applies statewide' },
  'US-CO': { rate: 2.9 },
  'US-CT': { rate: 6.35 },
  'US-DE': { rate: 0, note: 'no sales tax; the seller pays a gross receipts tax instead' },
  'US-DC': { rate: 6, note: 'the rise to 7% was postponed to 2027-10-01' },
  'US-FL': { rate: 6 },
  'US-GA': { rate: 4 },
  'US-HI': { rate: 4, note: 'general excise tax on the seller, 4.5% with the county surcharge in most counties' },
  'US-ID': { rate: 6 },
  'US-IL': { rate: 6.25 },
  'US-IN': { rate: 7 },
  'US-IA': { rate: 6 },
  'US-KS': { rate: 6.5 },
  'US-KY': { rate: 6 },
  'US-LA': { rate: 5, from: '2025-01-01', note: 'raised from 4.45% by the 2024 third extraordinary session' },
  'US-ME': { rate: 5.5 },
  'US-MD': { rate: 6 },
  'US-MA': { rate: 6.25 },
  'US-MI': { rate: 6 },
  'US-MN': { rate: 6.875 },
  'US-MS': { rate: 7 },
  'US-MO': { rate: 4.225 },
  'US-MT': { rate: 0, note: 'no general sales tax; some resort communities levy a resort tax' },
  'US-NE': { rate: 5.5 },
  'US-NV': { rate: 6.85 },
  'US-NH': { rate: 0, note: 'no general sales tax; a meals and rooms tax applies' },
  'US-NJ': { rate: 6.625 },
  'US-NM': { rate: 4.875, from: '2023-07-01', note: 'gross receipts tax, levied on the seller' },
  'US-NY': { rate: 4 },
  'US-NC': { rate: 4.75 },
  'US-ND': { rate: 5 },
  'US-OH': { rate: 5.75 },
  'US-OK': { rate: 4.5 },
  'US-OR': { rate: 0, note: 'no sales tax' },
  'US-PA': { rate: 6 },
  'US-RI': { rate: 7 },
  'US-SC': { rate: 6 },
  'US-SD': { rate: 4.2, from: '2023-07-01' },
  'US-TN': { rate: 7 },
  'US-TX': { rate: 6.25 },
  'US-UT': { rate: 4.85, note: 'mandatory local taxes bring the minimum combined rate to about 6.1%' },
  'US-VT': { rate: 6 },
  'US-VA': { rate: 5.3, note: '4.3% state plus the 1% local tax levied in every locality' },
  'US-WA': { rate: 6.5 },
  'US-WV': { rate: 6 },
  'US-WI': { rate: 5 },
  'US-WY': { rate: 4 },
};

export const US_RATE_SETS: readonly TaxRateSet[] = US_STATES.map(({ code }) => {
  const s = STATE_RATES[code]!;
  return {
    validFrom: s.from ?? '2026-01-01',
    subdivision: code,
    rates: [
      {
        rate: s.rate,
        kind: s.rate === 0 ? 'zero' : 'standard',
        appliesTo: `State rate; ${s.note ?? 'local rates are added on top'}`,
      },
    ],
  };
});

/** Current state-level rate in percent, or undefined for an unknown code. */
export function usStateRate(subdivision: string): number | undefined {
  return STATE_RATES[subdivision.toUpperCase()]?.rate;
}

/**
 * Economic nexus after South Dakota v. Wayfair (2018): a remote seller must
 * register once sales into the state pass the threshold. What counts as
 * "sales" differs (gross, retail, taxable) and so does the period (previous
 * or current calendar year, or 12 months), so this table answers "is it time
 * to check", not "you must register".
 */
export interface UsEconomicNexus {
  subdivision: string;
  /** USD; null when the state has no sales tax to collect. */
  sales: number | null;
  /** Number of separate transactions; null when the state has no count test. */
  transactions: number | null;
  /** 'or': either test triggers nexus; 'and': both are needed. */
  combine: 'or' | 'and';
  /** What the sales figure counts, when it is not plain gross sales into the state. */
  measures?: string;
  /** When the transaction test was dropped, if it was. */
  transactionsDroppedFrom?: string;
  source?: Source;
}

const nexus = (
  subdivision: string,
  sales: number | null,
  transactions: number | null,
  extra: Partial<UsEconomicNexus> = {},
): UsEconomicNexus => ({ subdivision, sales, transactions, combine: 'or', ...extra });

export const US_ECONOMIC_NEXUS: readonly UsEconomicNexus[] = [
  nexus('US-AL', 250_000, null, { measures: 'retail sales of tangible personal property' }),
  nexus('US-AK', 100_000, null, {
    measures: 'gross sales into ARSSTC member localities; local tax only',
    transactionsDroppedFrom: '2025-01-01',
    source: { title: 'Alaska Remote Seller Sales Tax Commission', url: 'https://arsstc.org/' },
  }),
  nexus('US-AZ', 100_000, null),
  nexus('US-AR', 100_000, 200),
  nexus('US-CA', 500_000, null, {
    measures: 'sales of tangible personal property',
    source: { title: 'CDTFA – Tax guide for out-of-state retailers', url: 'https://www.cdtfa.ca.gov/industry/wayfair.htm' },
  }),
  nexus('US-CO', 100_000, null),
  nexus('US-CT', 100_000, 200, { combine: 'and' }),
  nexus('US-DE', null, null),
  nexus('US-DC', 100_000, 200),
  nexus('US-FL', 100_000, null, { measures: 'taxable remote sales' }),
  nexus('US-GA', 100_000, 200),
  nexus('US-HI', 100_000, 200),
  nexus('US-ID', 100_000, null),
  nexus('US-IL', 100_000, null, { transactionsDroppedFrom: '2026-01-01' }),
  nexus('US-IN', 100_000, null, { transactionsDroppedFrom: '2024-01-01' }),
  nexus('US-IA', 100_000, null, { transactionsDroppedFrom: '2019-07-01' }),
  nexus('US-KS', 100_000, null),
  nexus('US-KY', 100_000, null, {
    transactionsDroppedFrom: '2026-08-01',
    source: {
      title: 'Avalara – Kentucky removes economic nexus transaction threshold (HB 757)',
      url: 'https://www.avalara.com/blog/en/north-america/2026/04/kentucky-removes-transaction-threshold-taxes-data-brokering-services.html',
    },
  }),
  nexus('US-LA', 100_000, null, { transactionsDroppedFrom: '2023-08-01' }),
  nexus('US-ME', 100_000, null, { transactionsDroppedFrom: '2022-01-01' }),
  nexus('US-MD', 100_000, 200),
  nexus('US-MA', 100_000, null),
  nexus('US-MI', 100_000, 200),
  nexus('US-MN', 100_000, 200, { measures: 'retail sales' }),
  nexus('US-MS', 250_000, null),
  nexus('US-MO', 100_000, null, { measures: 'taxable sales of tangible personal property' }),
  nexus('US-MT', null, null),
  nexus('US-NE', 100_000, 200),
  nexus('US-NV', 100_000, 200),
  nexus('US-NH', null, null),
  nexus('US-NJ', 100_000, 200),
  nexus('US-NM', 100_000, null, { measures: 'taxable gross receipts' }),
  nexus('US-NY', 500_000, 100, {
    combine: 'and',
    measures: 'gross receipts from tangible personal property, previous four sales-tax quarters',
    source: { title: 'NY DTF – Registration requirements for remote sellers', url: 'https://www.tax.ny.gov/bus/st/register.htm' },
  }),
  nexus('US-NC', 100_000, null, { transactionsDroppedFrom: '2024-07-01' }),
  nexus('US-ND', 100_000, null),
  nexus('US-OH', 100_000, 200),
  nexus('US-OK', 100_000, null),
  nexus('US-OR', null, null),
  nexus('US-PA', 100_000, null),
  nexus('US-RI', 100_000, 200),
  nexus('US-SC', 100_000, null),
  nexus('US-SD', 100_000, null, { transactionsDroppedFrom: '2023-07-01' }),
  nexus('US-TN', 100_000, null),
  nexus('US-TX', 500_000, null, {
    measures: 'total revenue from Texas, previous 12 months',
    source: { title: 'Texas Comptroller – Remote sellers', url: 'https://comptroller.texas.gov/taxes/sales/remote-sellers/' },
  }),
  nexus('US-UT', 100_000, null, { transactionsDroppedFrom: '2025-07-01' }),
  nexus('US-VT', 100_000, 200),
  nexus('US-VA', 100_000, 200),
  nexus('US-WA', 100_000, null, { transactionsDroppedFrom: '2019-03-14' }),
  nexus('US-WV', 100_000, 200),
  nexus('US-WI', 100_000, null, { transactionsDroppedFrom: '2019-02-20' }),
  nexus('US-WY', 100_000, null, { transactionsDroppedFrom: '2024-07-01' }),
];

/**
 * Whether sales into a state reach its economic-nexus threshold. Physical
 * presence (an office, staff, inventory) creates nexus regardless and is not
 * checked here.
 */
export function reachesEconomicNexus(subdivision: string, sales: number, transactions: number): boolean {
  const row = US_ECONOMIC_NEXUS.find((r) => r.subdivision === subdivision.toUpperCase());
  if (!row || row.sales == null) return false;
  const bySales = sales >= row.sales;
  if (row.transactions == null) return bySales;
  const byCount = transactions >= row.transactions;
  return row.combine === 'and' ? bySales && byCount : bySales || byCount;
}
