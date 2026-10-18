/**
 * "Vyplatí se paušální daň?" for a Czech OSVČ: one year in the paušální
 * režim (§ 2a ZDP) against the regular regime with the výdajový paušál
 * (§ 7 (7) ZDP) and with actual expenses. Each option is the whole yearly
 * cost: income tax + social + health insurance, minus a child bonus.
 *
 * Shared by the public calculator and the in-app one (prefilled from the
 * company's invoices and expenses). The regular regime is
 * computeOsvcAnnualSummary, the band amounts are cz-tax-years, so this
 * module only adds the credits the summary leaves out and the comparison.
 *
 * Assumes a main activity (hlavní činnost) with no other income, as the
 * paušální daň band amounts do.
 */
import { czTaxYear, flatTaxBandFor, flatTaxYearTotal, type CzTaxYear, type FlatTaxBand } from './cz-tax-years.js';
import { computeOsvcAnnualSummary, type OsvcFlatRate } from './osvc-annual.js';

export interface FlatTaxComparisonInput {
  year: number;
  income: number;
  actualExpenses: number;
  /** The activity: decides the výdajový paušál and the band limits of the paušální daň. */
  flatRate: OsvcFlatRate;
  /** A VAT payer cannot enter the paušální režim, § 2a (1) ZDP. */
  vatPayer?: boolean;
  /** Sleva na manželku / manžela (spouse with own income up to 68 000 Kč), § 35ba (1) b) ZDP. */
  spouse?: boolean;
  /** Number of dependent children in the household for the whole year, § 35c ZDP. */
  children?: number;
}

export type RegimeKind = 'flat_tax' | 'flat_expenses' | 'actual_expenses';
export type RegimeUnavailable = 'vat_payer' | 'over_limit' | 'no_data';

export interface RegimeOption {
  kind: RegimeKind;
  available: boolean;
  reason: RegimeUnavailable | null;
  /** Paušální daň band; null for the regular regime. */
  band: FlatTaxBand | null;
  /** Expenses claimed (regular regime only). */
  expenses: number | null;
  /** Income tax after all credits (regular regime only). */
  tax: number | null;
  /** Daňový bonus paid out for children (regular regime only, else 0). */
  bonus: number;
  social: number | null;
  health: number | null;
  /** Everything paid for the year, bonus subtracted; null when the option is not available. */
  total: number | null;
}

export interface FlatTaxComparison {
  year: number;
  options: RegimeOption[];
  /** The cheapest available option. */
  best: RegimeKind;
  /**
   * How much the best option saves against the other regime: against the
   * paušální daň when the regular regime wins, against the cheaper regular
   * option when the paušální daň wins. Without the paušální daň, against
   * the other regular option.
   */
  saving: number;
}

/** Child credit for `children` children: 1st, 2nd, then the 3rd amount for each further one. */
export function childCreditTotal(y: Pick<CzTaxYear, 'childCredits'>, children: number): number {
  let sum = 0;
  for (let i = 0; i < Math.max(0, Math.floor(children)); i++) sum += y.childCredits[Math.min(i, 2)]!;
  return sum;
}

/**
 * Tax after the credits. § 35ba credits (taxpayer, spouse) only lower the
 * tax to zero. The child credit lowers what is left, and the rest is paid
 * out as a daňový bonus when it is at least 100 Kč (§ 35c (3)) and the
 * § 7 income reached six times the minimum wage (§ 35c (4)).
 */
export function applyTaxCredits(
  taxBeforeCredit: number,
  y: Pick<CzTaxYear, 'taxpayerCredit' | 'spouseCredit' | 'childCredits' | 'minimumWage'>,
  opts: { income: number; spouse?: boolean; children?: number },
): { tax: number; bonus: number } {
  const basic = y.taxpayerCredit + (opts.spouse ? y.spouseCredit : 0);
  const afterBasic = Math.max(0, taxBeforeCredit - basic);
  const child = childCreditTotal(y, opts.children ?? 0);
  const used = Math.min(afterBasic, child);
  const rest = child - used;
  const bonus = rest >= 100 && opts.income >= 6 * y.minimumWage ? rest : 0;
  return { tax: afterBasic - used, bonus };
}

/** Null for a year without published parameters (the caller says "no data" instead of guessing). */
export function compareFlatTaxRegimes(input: FlatTaxComparisonInput): FlatTaxComparison | null {
  const y = czTaxYear(input.year);
  if (!y) return null;
  const income = Math.max(0, input.income);

  const regular = (kind: 'flat_expenses' | 'actual_expenses'): RegimeOption => {
    const s = computeOsvcAnnualSummary({
      year: input.year,
      income,
      actualExpenses: Math.max(0, input.actualExpenses),
      flatRate: kind === 'flat_expenses' ? input.flatRate : null,
    });
    const { tax, bonus } = applyTaxCredits(s.tax.beforeCredit, y, { income, spouse: input.spouse, children: input.children });
    return {
      kind,
      available: true,
      reason: null,
      band: null,
      expenses: s.expenses,
      tax,
      bonus,
      social: s.social.total,
      health: s.health.total,
      total: tax + s.social.total + s.health.total - bonus,
    };
  };

  const band = flatTaxBandFor(income, input.flatRate);
  const flatTotal = band == null ? null : flatTaxYearTotal(input.year, band);
  const reason: RegimeUnavailable | null = input.vatPayer ? 'vat_payer' : band == null ? 'over_limit' : flatTotal == null ? 'no_data' : null;
  const flat: RegimeOption = {
    kind: 'flat_tax',
    available: reason == null,
    reason,
    band,
    expenses: null,
    tax: null,
    bonus: 0,
    social: null,
    health: null,
    total: reason == null ? flatTotal : null,
  };

  const options = [flat, regular('flat_expenses'), regular('actual_expenses')];
  // On a tie the regular regime wins: it keeps the credits and the pension
  // base follows the real profit, and nothing has to be filed by 10 January.
  const ranked = options.filter((o) => o.total != null).sort((a, b) => a.total! - b.total! || rank(a.kind) - rank(b.kind));
  const best = ranked[0]!;
  // The question is "paušální daň or not", so compare across the regimes:
  // the two regular options often tie at the minimum bases.
  const other = ranked.find((o) => (best.kind === 'flat_tax') !== (o.kind === 'flat_tax')) ?? ranked[1] ?? best;
  return { year: input.year, options, best: best.kind, saving: other.total! - best.total! };
}

const rank = (k: RegimeKind) => (k === 'flat_expenses' ? 0 : k === 'actual_expenses' ? 1 : 2);
