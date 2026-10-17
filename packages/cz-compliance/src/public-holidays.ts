/**
 * Public holidays (days off) per country, for "the due date falls on a
 * holiday" and similar working-day checks. Each country is a plain list of
 * rules, so adding one means adding its list below; Easter-based holidays
 * are computed from `easterSunday`.
 *
 * Sources: CZ zákon č. 245/2000 Sb., SK zákon č. 241/1993 Z. z. (as amended
 * by the 2024 consolidation package, which turned 1 September and
 * 17 November into ordinary working days from 2025). Check the lists when
 * either law changes.
 *
 * All functions work on local calendar dates; the time of day is ignored.
 */

/** Easter Sunday of `year` (Gregorian, anonymous algorithm). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * A stable key for UI translations (`holidays.<key>`); the same key means
 * the same holiday in every country that has it.
 */
export type HolidayKey =
  | 'newYear'
  | 'slovakRepublic'
  | 'epiphany'
  | 'goodFriday'
  | 'easterMonday'
  | 'labourDay'
  | 'victoryDay'
  | 'cyrilMethodius'
  | 'janHus'
  | 'snp'
  | 'constitution'
  | 'ourLadyOfSorrows'
  | 'statehood'
  | 'independence'
  | 'allSaints'
  | 'freedomDemocracy'
  | 'christmasEve'
  | 'christmasDay'
  | 'stStephen';

type Rule = {
  key: HolidayKey;
  /** Name in the country's own language. */
  name: string;
  /** First and last year the day is a holiday (inclusive). */
  from?: number;
  until?: number;
} & ({ month: number; day: number } | { easterOffset: number });

const RULES = {
  CZ: [
    { key: 'newYear', name: 'Den obnovy samostatného českého státu, Nový rok', month: 1, day: 1 },
    { key: 'goodFriday', name: 'Velký pátek', easterOffset: -2, from: 2016 },
    { key: 'easterMonday', name: 'Velikonoční pondělí', easterOffset: 1 },
    { key: 'labourDay', name: 'Svátek práce', month: 5, day: 1 },
    { key: 'victoryDay', name: 'Den vítězství', month: 5, day: 8 },
    { key: 'cyrilMethodius', name: 'Den slovanských věrozvěstů Cyrila a Metoděje', month: 7, day: 5 },
    { key: 'janHus', name: 'Den upálení mistra Jana Husa', month: 7, day: 6 },
    { key: 'statehood', name: 'Den české státnosti', month: 9, day: 28 },
    { key: 'independence', name: 'Den vzniku samostatného československého státu', month: 10, day: 28 },
    { key: 'freedomDemocracy', name: 'Den boje za svobodu a demokracii', month: 11, day: 17 },
    { key: 'christmasEve', name: 'Štědrý den', month: 12, day: 24 },
    { key: 'christmasDay', name: '1. svátek vánoční', month: 12, day: 25 },
    { key: 'stStephen', name: '2. svátek vánoční', month: 12, day: 26 },
  ],
  SK: [
    { key: 'slovakRepublic', name: 'Deň vzniku Slovenskej republiky', month: 1, day: 1 },
    { key: 'epiphany', name: 'Zjavenie Pána (Traja králi)', month: 1, day: 6 },
    { key: 'goodFriday', name: 'Veľký piatok', easterOffset: -2 },
    { key: 'easterMonday', name: 'Veľkonočný pondelok', easterOffset: 1 },
    { key: 'labourDay', name: 'Sviatok práce', month: 5, day: 1 },
    { key: 'victoryDay', name: 'Deň víťazstva nad fašizmom', month: 5, day: 8 },
    { key: 'cyrilMethodius', name: 'Sviatok svätého Cyrila a svätého Metoda', month: 7, day: 5 },
    { key: 'snp', name: 'Výročie Slovenského národného povstania', month: 8, day: 29 },
    { key: 'constitution', name: 'Deň Ústavy Slovenskej republiky', month: 9, day: 1, until: 2024 },
    { key: 'ourLadyOfSorrows', name: 'Sedembolestná Panna Mária', month: 9, day: 15 },
    { key: 'allSaints', name: 'Sviatok Všetkých svätých', month: 11, day: 1 },
    { key: 'freedomDemocracy', name: 'Deň boja za slobodu a demokraciu', month: 11, day: 17, until: 2024 },
    { key: 'christmasEve', name: 'Štedrý deň', month: 12, day: 24 },
    { key: 'christmasDay', name: 'Prvý sviatok vianočný', month: 12, day: 25 },
    { key: 'stStephen', name: 'Druhý sviatok vianočný', month: 12, day: 26 },
  ],
} satisfies Record<string, Rule[]>;

export type HolidayCountry = keyof typeof RULES;
export const HOLIDAY_COUNTRIES = Object.keys(RULES) as HolidayCountry[];

export interface PublicHoliday {
  date: Date;
  key: HolidayKey;
  name: string;
}

/** `country` when holidays are known for it, else null (only weekends count then). */
export function holidayCountry(country: string | null | undefined): HolidayCountry | null {
  const code = (country ?? '').trim().toUpperCase();
  return code in RULES ? (code as HolidayCountry) : null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const cache = new Map<string, Map<string, PublicHoliday>>();

/** All public holidays of `year` in `country`, sorted; empty for an unknown country. */
export function publicHolidays(year: number, country: string): PublicHoliday[] {
  const code = holidayCountry(country);
  if (!code) return [];
  const easter = easterSunday(year);
  const rules: Rule[] = RULES[code];
  return rules
    .filter((r) => (r.from === undefined || year >= r.from) && (r.until === undefined || year <= r.until))
    .map((r) => ({
      key: r.key,
      name: r.name,
      date:
        'easterOffset' in r
          ? new Date(year, easter.getMonth(), easter.getDate() + r.easterOffset)
          : new Date(year, r.month - 1, r.day),
    }))
    .sort((x, y) => x.date.getTime() - y.date.getTime());
}

/** The public holiday on `date` in `country`, or null. */
export function publicHolidayOn(date: Date, country: string): PublicHoliday | null {
  const id = `${holidayCountry(country)}:${date.getFullYear()}`;
  let byDay = cache.get(id);
  if (!byDay) {
    byDay = new Map(publicHolidays(date.getFullYear(), country).map((h) => [dayKey(h.date), h]));
    cache.set(id, byDay);
  }
  return byDay.get(dayKey(date)) ?? null;
}

export function isWeekend(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

export function isWorkingDay(date: Date, country: string): boolean {
  return !isWeekend(date) && !publicHolidayOn(date, country);
}

/** `date` itself when it is a working day in `country`, otherwise the next one. */
export function nextWorkingDay(date: Date, country: string): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (!isWorkingDay(d, country)) d.setDate(d.getDate() + 1);
  return d;
}
