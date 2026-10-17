import { describe, expect, it } from 'vitest';
import {
  addMonths,
  advanceForDeadline,
  advanceMonthOf,
  advancesFor,
  advanceTotalFor,
  currentAdvancePeriod,
  isMonthKey,
  normalizeTaxAdvances,
  type TaxAdvancePeriod
} from '../tax-advances.js';

// Amounts differ per kind and per period, so a wrong pick can't match by accident.
const history: TaxAdvancePeriod[] = [
  { from: '2026-07', social: 5005, flat_tax: 9162 },
  { from: '2025-01', social: 4759, health: 3143, flat_tax: 8716 },
  { from: '2026-01', social: 5720, health: 3306, flat_tax: 9984 },
  { from: '2026-11', health: 0 }
];

describe('advancesFor', () => {
  it('takes the latest entry from that month or earlier, per kind', () => {
    expect(advancesFor(history, '2025-06')).toEqual({ social: 4759, health: 3143, flat_tax: 8716 });
    expect(advancesFor(history, '2026-01')).toEqual({ social: 5720, health: 3306, flat_tax: 9984 });
    expect(advancesFor(history, '2026-06')).toEqual({ social: 5720, health: 3306, flat_tax: 9984 });
  });

  it('a kind left out of a newer entry keeps the older amount', () => {
    expect(advancesFor(history, '2026-07')).toEqual({ social: 5005, health: 3306, flat_tax: 9162 });
  });

  it('0 is a real amount, not "not set"', () => {
    expect(advancesFor(history, '2026-12')).toEqual({ social: 5005, health: 0, flat_tax: 9162 });
  });

  it('nothing before the first entry, nothing for an empty list', () => {
    expect(advancesFor(history, '2024-12')).toEqual({});
    expect(advancesFor([], '2026-05')).toEqual({});
  });
});

describe('currentAdvancePeriod', () => {
  it('is the entry that started last on or before the month', () => {
    expect(currentAdvancePeriod(history, '2026-10')?.from).toBe('2026-07');
    expect(currentAdvancePeriod(history, '2026-07')?.from).toBe('2026-07');
    expect(currentAdvancePeriod(history, '2024-01')).toBeNull();
  });
});

describe('advanceMonthOf / advanceForDeadline', () => {
  it('social and health pay the month before, paušální daň the month itself', () => {
    expect(advanceMonthOf('social', new Date(2026, 0, 20))).toBe('2025-12');
    expect(advanceMonthOf('health', new Date(2026, 0, 8))).toBe('2025-12');
    expect(advanceMonthOf('flat_tax', new Date(2026, 0, 20))).toBe('2026-01');
  });

  it('the January payment of social still uses the old year amount', () => {
    expect(advanceForDeadline(history, 'social', new Date(2026, 0, 20))).toBe(4759);
    expect(advanceForDeadline(history, 'social', new Date(2026, 1, 20))).toBe(5720);
    expect(advanceForDeadline(history, 'flat_tax', new Date(2026, 0, 20))).toBe(9984);
    expect(advanceForDeadline(history, 'social', new Date(2026, 7, 20))).toBe(5005);
    expect(advanceForDeadline([], 'health', new Date(2026, 7, 8))).toBeUndefined();
  });
});

describe('advanceTotalFor', () => {
  it('sums the amount in force in each month of the year', () => {
    expect(advanceTotalFor(history, 'social', 2026)).toBe(6 * 5720 + 6 * 5005);
    expect(advanceTotalFor(history, 'health', 2026)).toBe(10 * 3306);
  });

  it('stops at lastMonth, null when nothing is set', () => {
    expect(advanceTotalFor(history, 'social', 2026, '2026-03')).toBe(3 * 5720);
    expect(advanceTotalFor(history, 'social', 2024)).toBeNull();
  });
});

describe('normalizeTaxAdvances', () => {
  it('turns the old single object into one entry', () => {
    expect(normalizeTaxAdvances({ social: 5720, health: 3306 })).toEqual([{ from: '2026-01', social: 5720, health: 3306 }]);
    expect(normalizeTaxAdvances({})).toEqual([]);
    expect(normalizeTaxAdvances(null)).toEqual([]);
  });

  it('sorts oldest first, drops bad months, amounts and empty entries', () => {
    const out = normalizeTaxAdvances([
      { from: '2026-07', social: 5005 },
      { from: '2026-13', social: 1 },
      { from: '2025-01', social: -5, health: 3143 },
      { from: '2025-06', flat_tax: 'x' },
      { from: '2024-02', health: 20_000_000 }
    ]);
    expect(out).toEqual([
      { from: '2025-01', health: 3143 },
      { from: '2026-07', social: 5005 }
    ]);
  });
});

describe('month keys', () => {
  it('validates and shifts months across years', () => {
    expect(isMonthKey('2026-01')).toBe(true);
    expect(isMonthKey('2026-1')).toBe(false);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-12', 1)).toBe('2027-01');
  });
});
