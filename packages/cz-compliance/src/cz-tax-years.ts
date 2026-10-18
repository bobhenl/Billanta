/**
 * Yearly Czech parameters for a sole trader (OSVČ), one block per year, each
 * number next to the page it was read from. The annual estimate, the public
 * calculators and the yearly filings (DPFO, přehled ČSSZ / ZP) all read this
 * table, so a figure is fixed in one place.
 *
 * Monthly advances that are actually due in a month stay in tax-minimums.ts
 * (that table answers "what do I pay in March"). This one answers "what is
 * the yearly minimum", which differs when a change applies back to January,
 * as the 2026 amendment did.
 *
 * Add a year once ČSSZ, VZP and Finanční správa publish it. A year missing
 * here makes the callers say "no data" instead of reusing old numbers.
 */
export interface CzTaxYear {
  /** Průměrná mzda / všeobecný vyměřovací základ for the year (Kč / month). */
  averageWage: number;
  /** Basic taxpayer credit, § 35ba (1) a) ZDP (Kč / year). */
  taxpayerCredit: number;
  /** Spouse credit with income under the limit, § 35ba (1) b) ZDP (Kč / year). */
  spouseCredit: number;
  /** 23 % applies above this multiple of the average wage, § 16 ZDP. */
  taxHighMultiple: number;
  /** Share of profit that is the social base, § 5b zákona č. 589/1992 Sb. */
  socialBaseShare: number;
  /** Maximum yearly social base as a multiple of the average wage. */
  socialMaxMultiple: number;
  social: {
    /** Monthly minimum base share of the average wage, main activity (hlavní činnost), from January. */
    mainShare: number;
    /** A change during the year: what is due from `fromMonth` on. */
    mainShareFrom?: { fromMonth: number; share: number };
    /**
     * Share the yearly minimum base is counted from in the přehled. Equal to
     * `mainShare` unless a change applied to the whole year (2026: 35 %, the
     * Jan–Jun advances at 40 % become an overpayment).
     */
    annualMainShare: number;
    /** Reduced share for the first years of business (25 %), null before 2024. */
    starterShare: number | null;
    /** Secondary activity (vedlejší činnost) monthly minimum share. */
    secondaryShare: number;
    /** Rozhodná částka: secondary activity below this profit is not insured (Kč / year). */
    secondaryThreshold: number;
  };
  /** Health insurance: the monthly minimum base is this share of the average wage. */
  healthMinShare: number;
  /** Paušální daň per month (tax + social + health) by band, § 2a ZDP. */
  flatTax: { 1: number; 2: number; 3: number };
  /** Band-1 amount after a change; `retroactive` = counted for the whole year. */
  flatTaxBand1From?: { fromMonth: number; amount: number; retroactive: boolean };
}

export const CZ_TAX_YEARS: Record<number, CzTaxYear> = {
  2023: {
    // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (VVZ 40 324, minimum 10 081 = 25 %)
    averageWage: 40_324,
    // https://www.zakonyprolidi.cz/cs/1992-586#p35ba
    taxpayerCredit: 30_840,
    spouseCredit: 24_840,
    // https://www.zakonyprolidi.cz/cs/1992-586#p16 (2023: 48× the average wage, 1 935 552 Kč)
    taxHighMultiple: 48,
    // https://www.zakonyprolidi.cz/cs/1992-589#p5b (50 % until 2023)
    socialBaseShare: 0.5,
    socialMaxMultiple: 48,
    social: {
      mainShare: 0.25, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (120 972 / year)
      annualMainShare: 0.25,
      starterShare: null,
      secondaryShare: 0.1, // same page: 48 396 / year
      secondaryThreshold: 96_777, // 2.4× the average wage; not seen on an official page
    },
    healthMinShare: 0.5, // https://www.zakonyprolidi.cz/cs/1992-592#p3a (20 162 → 2 722 Kč)
    // https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan
    // 6 208 / 16 000 / 26 000: from secondary sources that agree, not read on the FS page itself.
    flatTax: { 1: 6_208, 2: 16_000, 3: 26_000 },
  },
  2024: {
    averageWage: 43_967, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc
    taxpayerCredit: 30_840, // https://www.zakonyprolidi.cz/cs/1992-586#p35ba
    spouseCredit: 24_840,
    taxHighMultiple: 36, // https://www.zakonyprolidi.cz/cs/1992-586#p16 (consolidation package, 1 582 812 Kč)
    socialBaseShare: 0.55, // https://www.zakonyprolidi.cz/cs/1992-589#p5b
    socialMaxMultiple: 48,
    social: {
      mainShare: 0.3, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (158 292 / year)
      annualMainShare: 0.3,
      starterShare: 0.25, // same page: 131 904 / year
      secondaryShare: 0.11, // same page: 58 044 / year
      secondaryThreshold: 105_520, // 2.4× the average wage; not seen on an official page
    },
    healthMinShare: 0.5, // https://www.zakonyprolidi.cz/cs/1992-592#p3a (21 984 → 2 968 Kč)
    // https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-zakladnim-zmenam-v
    flatTax: { 1: 7_498, 2: 16_745, 3: 27_139 },
  },
  2025: {
    averageWage: 46_557, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc
    taxpayerCredit: 30_840, // https://www.zakonyprolidi.cz/cs/1992-586#p35ba
    spouseCredit: 24_840,
    taxHighMultiple: 36, // https://www.zakonyprolidi.cz/cs/1992-586#p16 (1 676 052 Kč)
    socialBaseShare: 0.55, // https://www.zakonyprolidi.cz/cs/1992-589#p5b
    socialMaxMultiple: 48, // ČSSZ zadání přehledu 2025: maximum 2 234 736 Kč
    social: {
      mainShare: 0.35, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (195 540 / year)
      annualMainShare: 0.35,
      starterShare: 0.25, // same page: 139 680 / year
      secondaryShare: 0.11, // same page: 61 464 / year
      // https://www.cssz.gov.cz/definice-e-podani-osvc (zadání pro programátory 2025, ř. 24)
      secondaryThreshold: 111_736,
    },
    healthMinShare: 0.5, // https://www.zakonyprolidi.cz/cs/1992-592#p3a (23 279 → 3 143 Kč)
    // https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025
    flatTax: { 1: 8_716, 2: 16_745, 3: 27_139 },
  },
  2026: {
    averageWage: 48_967, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc
    taxpayerCredit: 30_840, // https://www.zakonyprolidi.cz/cs/1992-586#p35ba
    spouseCredit: 24_840,
    taxHighMultiple: 36, // https://www.zakonyprolidi.cz/cs/1992-586#p16 (1 762 812 Kč)
    socialBaseShare: 0.55, // https://www.zakonyprolidi.cz/cs/1992-589#p5b
    socialMaxMultiple: 48,
    social: {
      mainShare: 0.4, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (19 587 → 5 720 Kč)
      // https://www.cssz.gov.cz/zmena-vyse-minimalnich-zaloh-osvc-v-roce-2024 (17 139 → 5 005 Kč from July)
      mainShareFrom: { fromMonth: 7, share: 0.35 },
      // https://mf.gov.cz/cs/ministerstvo/media/tiskove-zpravy/2026/minimalni-zalohy-na-socialni-odvody-osvc-pro-rok-2-64112
      // The whole of 2026 is counted at 35 %; Jan–Jun paid at 40 % is an overpayment in the přehled.
      annualMainShare: 0.35,
      starterShare: 0.25, // https://www.cssz.gov.cz/vyse-minimalnich-vymerovacich-zakladu-osvc (146 904 / year)
      secondaryShare: 0.11, // same page: 64 644 / year
      secondaryThreshold: 117_521, // 2.4× the average wage; secondary sources, not seen on cssz.gov.cz
    },
    healthMinShare: 0.5, // https://www.zakonyprolidi.cz/cs/1992-592#p3a (24 484 → 3 306 Kč, unchanged by the amendment)
    // https://financnisprava.gov.cz/cs/dane/dane/dan-z-prijmu/pausalni-dan/informace-k-institutu-pausalni-dane-pro-rok-2025
    flatTax: { 1: 9_984, 2: 16_745, 3: 27_139 },
    // https://financnisprava.gov.cz/cs/financni-sprava/media-a-verejnost/tiskove-zpravy-gfr/tiskove-zpravy-2026/poplatnikum-v-prvnim-pasmu-pausalniho-rezimu-snizeni-zalohy
    // 9 162 Kč from 1 January 2026; first due at the lower amount on 20 July.
    flatTaxBand1From: { fromMonth: 7, amount: 9_162, retroactive: true },
  },
};

/** Years with a full parameter set, oldest first. */
export const CZ_TAX_YEAR_LIST: readonly number[] = Object.keys(CZ_TAX_YEARS)
  .map(Number)
  .sort((a, b) => a - b);

export function czTaxYear(year: number): CzTaxYear | null {
  return CZ_TAX_YEARS[year] ?? null;
}

export type FlatTaxBand = 1 | 2 | 3;

/** Paušální daň due for `month` (1–12) of `year` in a band, or null for an unknown year. */
export function flatTaxMonthly(year: number, band: FlatTaxBand, month: number): number | null {
  const y = czTaxYear(year);
  if (!y) return null;
  if (band === 1 && y.flatTaxBand1From && month >= y.flatTaxBand1From.fromMonth) return y.flatTaxBand1From.amount;
  return y.flatTax[band];
}

/**
 * Paušální daň for a whole year in a band, as it is finally settled: a
 * retroactive change counts for all twelve months, so the 2026 band 1 is
 * 12 × 9 162 Kč (what was paid above that comes back as an overpayment).
 */
export function flatTaxYearTotal(year: number, band: FlatTaxBand): number | null {
  const y = czTaxYear(year);
  if (!y) return null;
  if (band === 1 && y.flatTaxBand1From?.retroactive) return 12 * y.flatTaxBand1From.amount;
  let sum = 0;
  for (let m = 1; m <= 12; m++) sum += flatTaxMonthly(year, band, m)!;
  return sum;
}

/**
 * The lowest band of paušální daň the income fits (§ 2a ZDP), or null when it
 * does not fit at all. Band 1: 1 M Kč, 1.5 M when the income falls under the
 * 80 % or 60 % flat-expense rate, 2 M under 80 %. Band 2: 1.5 M, 2 M under 80 %
 * or 60 %. Band 3: 2 M. The law says "at least 75 % of the income"; the
 * calculator asks for one activity type, so that reduces to the chosen rate.
 */
export function flatTaxBandFor(income: number, flatRate: 80 | 60 | 40 | 30 | null): FlatTaxBand | null {
  const strong = flatRate === 80 || flatRate === 60;
  if (income <= 1_000_000 || (income <= 1_500_000 && strong) || (income <= 2_000_000 && flatRate === 80)) return 1;
  if (income <= 1_500_000 || (income <= 2_000_000 && strong)) return 2;
  if (income <= 2_000_000) return 3;
  return null;
}
