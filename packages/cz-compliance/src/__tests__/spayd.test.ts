import { describe, expect, it } from 'vitest';
import { generateSpaydString } from '../spayd.js';

describe('generateSpaydString', () => {
  it('generates a minimal string with only the required IBAN field', () => {
    const result = generateSpaydString({ iban: 'CZ6508000000192000145399' });
    expect(result).toBe('SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK');
  });

  it('generates a full string with amount, currency, variable symbol, and message', () => {
    const result = generateSpaydString({
      iban: 'CZ6508000000192000145399',
      amount: 1500,
      currency: 'CZK',
      variableSymbol: '20240001',
      message: 'Faktura 20240001',
    });

    expect(result).toBe(
      'SPD*1.0*ACC:CZ6508000000192000145399*AM:1500.00*CC:CZK*X-VS:20240001*MSG:Faktura 20240001',
    );
  });

  it('normalizes IBAN casing/whitespace and defaults currency to CZK', () => {
    const result = generateSpaydString({ iban: 'cz65 0800 0000 1920 0014 5399' });
    expect(result).toBe('SPD*1.0*ACC:CZ6508000000192000145399*CC:CZK');
  });

  it('appends BIC to the ACC field when provided', () => {
    const result = generateSpaydString({ iban: 'CZ6508000000192000145399', bic: 'GIBACZPX' });
    expect(result).toContain('ACC:CZ6508000000192000145399+GIBACZPX');
  });

  it('formats amounts with exactly two decimal places', () => {
    const result = generateSpaydString({ iban: 'CZ6508000000192000145399', amount: 99.5 });
    expect(result).toContain('AM:99.50');
  });

  it('escapes reserved characters (*, +, backslash) in free-text fields', () => {
    const result = generateSpaydString({
      iban: 'CZ6508000000192000145399',
      message: 'Invoice #1*special+chars\\here',
    });
    expect(result).toContain('MSG:Invoice #1\\*special\\+chars\\\\here');
  });

  it('truncates the message to 60 characters per the SPAYD spec', () => {
    const longMessage = 'x'.repeat(100);
    const result = generateSpaydString({ iban: 'CZ6508000000192000145399', message: longMessage });
    const msgField = result.split('*').find((f) => f.startsWith('MSG:'))!;
    expect(msgField).toBe(`MSG:${'x'.repeat(60)}`);
  });

  it('encodes the due date as YYYYMMDD via DT', () => {
    const result = generateSpaydString({
      iban: 'CZ6508000000192000145399',
      dueDate: new Date(Date.UTC(2026, 8, 30)),
    });
    expect(result).toContain('DT:20260930');
  });

  it('throws when IBAN is missing or empty', () => {
    expect(() => generateSpaydString({ iban: '' })).toThrow();
    // @ts-expect-error deliberately omitting required field to test runtime guard
    expect(() => generateSpaydString({})).toThrow();
  });
});
