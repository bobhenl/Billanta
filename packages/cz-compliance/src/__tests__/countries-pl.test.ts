import { describe, expect, it } from 'vitest';
import { countryPackProblems } from '../countries/contract.js';
import {
  PL,
  isValidNip,
  isValidRegon,
  mppRequired,
  normalizeNip,
  plDeadline,
  plDeadlines,
  plHolidays,
  plRateDate,
} from '../countries/pl/index.js';

describe('PL country pack', () => {
  it('passes the contract checks', () => {
    expect(countryPackProblems(PL)).toEqual([]);
  });

  it('has 23/8/5/0 as the current VAT rates', () => {
    const current = PL.indirectTax.rateSets.at(-1)!;
    expect(current.validFrom).toBe('2011-01-01');
    expect(current.rates.map((r) => r.rate)).toEqual([23, 8, 5, 0]);
    expect(PL.indirectTax.smallBusiness?.threshold).toBe(240_000);
    expect(PL.indirectTax.smallBusiness?.invoiceNote.pl).toContain('art. 113 ust. 1');
  });

  it('lists the KSeF phases in order', () => {
    expect(PL.einvoicing.filter((m) => m.platform === 'KSeF').map((m) => m.from)).toEqual([
      '2026-02-01',
      '2026-04-01',
      '2027-01-01',
    ]);
  });
});

describe('NIP', () => {
  it('accepts published NIPs in any common notation', () => {
    expect(isValidNip('5260250995')).toBe(true); // Ministerstwo Finansów
    expect(isValidNip('526-025-09-95')).toBe(true);
    expect(isValidNip('PL 526 025 09 95')).toBe(true);
    expect(isValidNip('5261040828')).toBe(true); // GUS
    expect(normalizeNip('PL526-025-09-95')).toBe('5260250995');
  });

  it('rejects bad checksums and formats', () => {
    expect(isValidNip('5260250994')).toBe(false);
    expect(isValidNip('526025099')).toBe(false);
    expect(isValidNip('0000000000')).toBe(false);
    expect(isValidNip('')).toBe(false);
    // Weighted sum ≡ 10 (mod 11) is never a valid NIP: 1234567890 → 10.
    expect(isValidNip('1234567890')).toBe(false);
  });
});

describe('REGON', () => {
  it('accepts 9- and 14-digit numbers with a valid checksum', () => {
    expect(isValidRegon('000002217')).toBe(true); // Ministerstwo Finansów
    expect(isValidRegon('00000221700018')).toBe(true);
  });

  it('rejects bad checksums', () => {
    expect(isValidRegon('000002218')).toBe(false);
    expect(isValidRegon('00000221700019')).toBe(false);
    // Valid local-unit check digit but an invalid parent REGON.
    expect(isValidRegon('00000221800013')).toBe(false);
    expect(isValidRegon('12345')).toBe(false);
  });
});

describe('split payment (MPP)', () => {
  it('applies above PLN 15,000 gross with an Annex 15 item only', () => {
    expect(mppRequired(15_000, true)).toBe(false);
    expect(mppRequired(15_000.01, true)).toBe(true);
    expect(mppRequired(50_000, false)).toBe(false);
  });
});

describe('PL holidays', () => {
  it('matches the official 2026 list (14 days off)', () => {
    expect(plHolidays(2026)).toEqual([
      '2026-01-01',
      '2026-01-06',
      '2026-04-05',
      '2026-04-06',
      '2026-05-01',
      '2026-05-03',
      '2026-05-24',
      '2026-06-04',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it('has Christmas Eve only from 2025', () => {
    expect(plHolidays(2024)).not.toContain('2024-12-24');
    expect(plHolidays(2025)).toContain('2025-12-24');
  });
});

describe('PL deadlines', () => {
  it('moves a deadline past weekends and holidays', () => {
    // 25 Dec 2026 is a Friday holiday, 26 Saturday, 27 Sunday.
    expect(plDeadline(2026, 12, 25)).toBe('2026-12-28');
    // 25 Jan 2026 is a Sunday.
    expect(plDeadline(2026, 1, 25)).toBe('2026-01-26');
  });

  it('lists the monthly JPK_V7M and ZUS dates', () => {
    const all = plDeadlines(2026);
    const vat = all.filter((d) => d.kind === 'vat_return').map((d) => d.date);
    expect(vat).toHaveLength(12);
    expect(vat[0]).toBe('2026-01-26');
    expect(vat[11]).toBe('2026-12-28');
    expect(all.find((d) => d.kind === 'annual_income_tax')?.date).toBe('2026-04-30');
    expect(all.filter((d) => d.kind === 'social_contributions')).toHaveLength(12);
  });

  it('takes the NBP rate from the last working day before the tax point', () => {
    // Tax point Tuesday 7 Apr 2026: Monday 6 Apr is Easter Monday, so Friday 3 Apr.
    expect(plRateDate('2026-04-07')).toBe('2026-04-03');
    expect(plRateDate('2026-10-21')).toBe('2026-10-20');
  });
});
