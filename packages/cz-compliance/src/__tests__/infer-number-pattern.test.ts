import { describe, expect, it } from 'vitest';
import { inferNumberPattern } from '../number-format.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const samples = (...pairs: [string, string][]) => pairs.map(([number, date]) => ({ number, issueDate: d(date) }));

describe('inferNumberPattern', () => {
  it('reads common shapes from other invoicing tools', () => {
    expect(inferNumberPattern(samples(['FV2025017', '2025-03-01'], ['FV2025018', '2025-03-04'], ['FV2025123', '2025-11-30']))).toBe('FV{YYYY}{NNN}');
    expect(inferNumberPattern(samples(['250012', '2025-02-01'], ['250013', '2025-06-01']))).toBe('{YY}{NNNN}');
    expect(inferNumberPattern(samples(['2025/0007', '2025-05-02'], ['2025/0008', '2025-05-09']))).toBe('{YYYY}/{NNNN}');
    expect(inferNumberPattern(samples(['20250017', '2025-01-10'], ['20250018', '2025-04-10']))).toBe('{YYYY}{NNNN}');
  });

  it('keeps a monthly counter when the month is in the number', () => {
    expect(inferNumberPattern(samples(['1/10/2025', '2025-10-02'], ['2/10/2025', '2025-10-08'], ['1/11/2025', '2025-11-03']))).toBe('{N}/{MM}/{YYYY}');
  });

  it('does not pad a sequence the source never padded', () => {
    expect(inferNumberPattern(samples(['2025-1', '2025-01-02'], ['2025-15', '2025-03-02']))).toBe('{YYYY}-{N}');
  });

  it('prefers a yearly counter when both fit', () => {
    expect(inferNumberPattern(samples(['FV2025017', '2025-01-03']))).toBe('FV{YYYY}{NNN}');
  });

  it('gives up without a year in the number or with mixed shapes', () => {
    expect(inferNumberPattern(samples(['123', '2025-01-01'], ['124', '2025-02-01']))).toBeNull();
    expect(inferNumberPattern(samples(['FV2025001', '2025-01-01'], ['X-7', '2025-01-02'], ['Y-9', '2025-01-03']))).toBeNull();
    expect(inferNumberPattern([])).toBeNull();
  });

  it('checks the year against the issue date', () => {
    // 2024 in the number but issued in 2025: not a year token.
    expect(inferNumberPattern(samples(['2024001', '2025-01-05'], ['2024002', '2025-02-05']))).toBeNull();
  });
});
