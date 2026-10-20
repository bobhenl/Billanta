import { describe, expect, it } from 'vitest';
import { buildIcs } from '../ics.js';

describe('buildIcs', () => {
  const now = new Date('2026-10-19T08:00:00Z');

  it('writes all-day events with an exclusive end date across a month end', () => {
    const ics = buildIcs('Daňový kalendář', [{ uid: 'a@billanta', date: '2026-12-31', summary: 'DPH' }], now);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101');
    expect(ics).toContain('DTSTAMP:20261019T080000Z');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes text values', () => {
    const ics = buildIcs('x', [{ uid: 'b', date: '2026-01-01', summary: 'a, b; c\\d\ne' }], now);
    expect(ics).toContain('SUMMARY:a\\, b\\; c\\\\d\\ne');
  });

  it('folds lines to 75 octets without splitting a multi-byte character', () => {
    const ics = buildIcs('x', [{ uid: 'c', date: '2026-01-01', summary: 'ř'.repeat(60) }], now);
    const line = ics.split('\r\n').findIndex((l) => l.startsWith('SUMMARY:'));
    const lines = ics.split('\r\n');
    const enc = new TextEncoder();
    expect(enc.encode(lines[line]!).length).toBeLessThanOrEqual(75);
    expect(lines[line + 1]!.startsWith(' ')).toBe(true);
    expect(lines.slice(line, line + 3).map((l, i) => (i ? l.slice(1) : l)).join('').includes('ř'.repeat(60))).toBe(true);
  });
});
