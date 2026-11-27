import { describe, expect, it } from 'vitest';
import { sumWithOpened, type DocumentAmounts } from '../index.js';

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAA${n}:${'Q'.repeat(24)}`;
const totals = (withoutVat: number, vat: number): DocumentAmounts => ({
  totalWithoutVat: withoutVat,
  totalVat: vat,
  totalWithVat: withoutVat + vat,
  byRate: [],
});

describe('sumWithOpened', () => {
  const opened = new Map([
    [env(1), totals(1000, 210)],
    [env(2), totals(100.1, 21.02)],
  ]);

  it('adds the opened totals to the server sum', () => {
    expect(sumWithOpened(500, [env(1), env(2)], opened)).toEqual({ sum: 1831.12, missing: 0 });
  });

  it('sums the requested field', () => {
    expect(sumWithOpened(0, [env(1), env(2)], opened, 'totalWithoutVat').sum).toBe(1100.1);
    expect(sumWithOpened(0, [env(1), env(2)], opened, 'totalVat').sum).toBe(231.02);
  });

  it('rounds to cents like the server sums', () => {
    expect(sumWithOpened(0.1, [env(4)], new Map([[env(4), totals(0.2, 0)]])).sum).toBe(0.3);
  });

  it('counts what is not opened instead of adding 0 in silence', () => {
    expect(sumWithOpened(500, [env(1), env(3)], opened)).toEqual({ sum: 1710, missing: 1 });
    expect(sumWithOpened(500, [env(1), env(3)], null)).toEqual({ sum: 500, missing: 2 });
  });

  it('ignores values that are not envelopes: they are already in the plain part', () => {
    expect(sumWithOpened(500, [null, undefined, '', '1210'], opened)).toEqual({ sum: 500, missing: 0 });
  });
});
