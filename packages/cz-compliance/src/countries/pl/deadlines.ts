import type { CountryTaxDeadline, LocalizedText } from '../types.js';
import { plDeadline } from './holidays.js';

const MONTHS_PL = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "for December 2025" style suffix for the month before `month` (1-based) of `year`. */
function previousPeriod(year: number, month: number): { pl: string; en: string } {
  const m = month === 1 ? 12 : month - 1;
  const y = month === 1 ? year - 1 : year;
  return { pl: `${MONTHS_PL[m - 1]} ${y}`, en: `${MONTHS_EN[m - 1]} ${y}` };
}

/**
 * The main deadlines of a Polish sole trader (JDG) falling in `year`, each
 * moved to the next working day per Ordynacja podatkowa art. 12 § 5.
 * Employer forms (PIT-4R, PIT-11) and the quarterly JPK_V7K variant are left
 * out; JPK_V7K filers still send monthly records on the same dates.
 */
export function plDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  const add = (month: number, day: number, kind: string, title: LocalizedText, appliesTo?: string) =>
    out.push({ date: plDeadline(year, month, day), kind, title, ...(appliesTo ? { appliesTo } : {}) });

  for (let month = 1; month <= 12; month++) {
    const period = previousPeriod(year, month);
    // Ustawa o systemie ubezpieczeń społecznych art. 47 ust. 1 pkt 1: the
    // self-employed paying only for themselves pay by the 20th (since 2023).
    add(month, 20, 'social_contributions', {
      pl: `Składki ZUS za ${period.pl}`,
      en: `ZUS contributions for ${period.en}`,
    }, 'self-employed paying only for themselves');
    // Ustawa o PIT art. 44 ust. 6 (skala, liniowy); ustawa o zryczałtowanym
    // podatku art. 21 ust. 1 (ryczałt): monthly advance by the 20th of the
    // next month, the December one by 20 January.
    add(month, 20, 'income_tax_advance', {
      pl: `Zaliczka na PIT / ryczałt za ${period.pl}`,
      en: `Income tax advance for ${period.en}`,
    }, 'monthly payers; quarterly payers in January, April, July and October');
    // Ustawa o VAT art. 99 ust. 1 and art. 109 ust. 3b: JPK_V7M with the VAT
    // payment by the 25th of the following month.
    add(month, 25, 'vat_return', {
      pl: `JPK_V7M i VAT za ${period.pl}`,
      en: `JPK_V7M VAT return and payment for ${period.en}`,
    }, 'VAT-registered taxpayers');
  }

  // Ustawa o PIT art. 9a ust. 2: a change to liniowy or ryczałt is declared
  // by the 20th of the month after the first income of the year, usually 20 February.
  add(2, 20, 'tax_form_choice', {
    pl: 'Zmiana formy opodatkowania na bieżący rok',
    en: 'Change of income tax form for this year',
  }, 'sole traders changing their tax form');
  // Ustawa o PIT art. 45 ust. 1 (PIT-36, PIT-36L); ustawa o zryczałtowanym
  // podatku art. 21 ust. 1a (PIT-28): annual return by 30 April.
  add(4, 30, 'annual_income_tax', {
    pl: `Zeznanie roczne PIT-36 / PIT-36L / PIT-28 za ${year - 1}`,
    en: `Annual income tax return for ${year - 1}`,
  });
  // Ustawa o świadczeniach opieki zdrowotnej art. 81 ust. 2h: the annual
  // health contribution reconciliation goes with the April ZUS filing, by 20 May.
  add(5, 20, 'health_contribution_reconciliation', {
    pl: `Roczne rozliczenie składki zdrowotnej za ${year - 1}`,
    en: `Annual health contribution reconciliation for ${year - 1}`,
  }, 'sole traders on skala, liniowy or ryczałt');

  return out.sort((a, b) => a.date.localeCompare(b.date));
}
