import { easterSunday } from '../../public-holidays.js';
import type { CountryTaxDeadline } from '../types.js';

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const fromEaster = (year: number, days: number): string => {
  const d = easterSunday(year);
  d.setDate(d.getDate() + days);
  return iso(d);
};

/**
 * Mandatory public holidays (feriados obrigatórios), Código do Trabalho
 * art. 234.º as restored by Lei 8/2016. Carnival (Shrove Tuesday) and the
 * municipal holiday are optional (art. 235.º) and left out; Azores and
 * Madeira add their regional days.
 */
export function ptHolidays(year: number): string[] {
  const fixed = ['01-01', '04-25', '05-01', '06-10', '08-15', '10-05', '11-01', '12-01', '12-08', '12-25'];
  return [
    ...fixed.map((md) => `${year}-${md}`),
    fromEaster(year, -2), // Sexta-feira Santa
    fromEaster(year, 0), // Páscoa
    fromEaster(year, 60), // Corpo de Deus
  ].sort();
}

/**
 * A filing deadline on a weekend or public holiday moves to the next working
 * day (CPPT art. 20.º n.º 1 via Código Civil art. 279.º e)).
 */
function nextWorkingDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const holidays = new Set(ptHolidays(d.getFullYear()));
  while (d.getDay() === 0 || d.getDay() === 6 || holidays.has(iso(d))) d.setDate(d.getDate() + 1);
  return iso(d);
}

/**
 * Periodic IVA return (declaração periódica) under CIVA art. 41.º: filed by
 * the 20th and paid by the 25th of the second month after the period – the
 * month for the monthly regime (turnover ≥ EUR 650,000), the quarter for the
 * quarterly one. Only the quarterly regime is listed; it is the one small
 * businesses use.
 * Source: https://info.portaldasfinancas.gov.pt/pt/informacao_fiscal/codigos_tributarios/civa_rep/Pages/codigo-do-iva-indice.aspx
 */
export function ptDeadlines(year: number): CountryTaxDeadline[] {
  const out: CountryTaxDeadline[] = [];
  // [month due (1-based), period label]
  const quarters: [number, string][] = [
    [2, `T4 ${year - 1}`],
    [5, `T1 ${year}`],
    [8, `T2 ${year}`],
    [11, `T3 ${year}`],
  ];
  for (const [month, period] of quarters) {
    const mm = String(month).padStart(2, '0');
    out.push({
      date: nextWorkingDay(`${year}-${mm}-20`),
      kind: 'vat_return',
      title: { pt: `Declaração periódica de IVA ${period}`, en: `Periodic VAT return ${period}` },
      appliesTo: 'quarterly IVA filers',
    });
    out.push({
      date: nextWorkingDay(`${year}-${mm}-25`),
      kind: 'vat_payment',
      title: { pt: `Pagamento do IVA ${period}`, en: `VAT payment ${period}` },
      appliesTo: 'quarterly IVA filers',
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
