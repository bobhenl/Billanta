import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * National public holidays (fiestas laborales de ámbito nacional), the ones
 * every region keeps: Estatuto de los Trabajadores art. 37.2 and RD 2001/1983
 * art. 45. Holy Thursday, Easter Monday and the regional days are set each
 * year by the autonomous communities (yearly BOE resolution of the Dirección
 * General de Trabajo), so they are left out. When a national holiday falls on
 * a Sunday the regions may move it to Monday; that move is regional too.
 */
export function esHolidays(year: number): string[] {
  const goodFriday = easterSunday(year);
  goodFriday.setDate(goodFriday.getDate() - 2);
  const fixed = ['01-01', '01-06', '05-01', '08-15', '10-12', '11-01', '12-06', '12-08', '12-25'];
  return [...fixed.map((md) => `${year}-${md}`), iso(goodFriday)].sort();
}

/**
 * A deadline that falls on a Saturday, Sunday or national holiday moves to
 * the next working day (Ley 39/2015 art. 30.5, applied to tax filing by
 * Ley 58/2003 LGT art. 48.3). Regional and Madrid holidays can move it
 * further; AEAT publishes the exact dates in its calendario del contribuyente.
 */
function nextWorkingDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const holidays = new Set(esHolidays(d.getFullYear()));
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/**
 * Main quarterly and annual returns for autónomos and small companies in
 * common territory (not the Basque Country or Navarre).
 * - Modelo 303 (IVA) and 130 (IRPF prepayment): 1–20 April, July, October
 *   for Q1–Q3 and 1–30 January for Q4 (RIVA art. 71.4, RIRPF art. 110).
 * - Modelo 390 (annual IVA summary): 1–30 January (RIVA art. 71.6 and the
 *   order approving the form).
 * Source: https://sede.agenciatributaria.gob.es/Sede/calendario-contribuyente.html
 */
export function esDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  const quarterly: [string, string][] = [
    [`${year}-01-30`, `Q4 ${year - 1}`],
    [`${year}-04-20`, `Q1 ${year}`],
    [`${year}-07-20`, `Q2 ${year}`],
    [`${year}-10-20`, `Q3 ${year}`],
  ];
  for (const [date, period] of quarterly) {
    const due = nextWorkingDay(date);
    out.push({
      date: due,
      kind: 'vat_return',
      title: { es: `Modelo 303 – IVA ${period}`, en: `Form 303 – VAT return ${period}` },
      appliesTo: 'quarterly IVA filers (monthly for SII and REDEME)',
    });
    out.push({
      date: due,
      kind: 'income_tax_prepayment',
      title: { es: `Modelo 130 – pago fraccionado IRPF ${period}`, en: `Form 130 – income tax prepayment ${period}` },
      appliesTo: 'autónomos in estimación directa not withheld on 70 % or more of income',
    });
  }
  out.push({
    date: nextWorkingDay(`${year}-01-30`),
    kind: 'vat_annual_summary',
    title: { es: `Modelo 390 – resumen anual IVA ${year - 1}`, en: `Form 390 – annual VAT summary ${year - 1}` },
    appliesTo: 'IVA filers not exempted from it (SII users are)',
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
