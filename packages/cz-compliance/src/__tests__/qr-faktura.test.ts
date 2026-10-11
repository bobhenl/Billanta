import { describe, expect, it } from 'vitest';
import { generateQrInvoiceString, parseInvoiceQr, qrInvoiceForSpayd } from '../qr-faktura.js';
import { generateSpaydString } from '../spayd.js';

const sid = generateQrInvoiceString({
  invoiceNumber: '2026-0042',
  issueDate: new Date('2026-10-01T00:00:00Z'),
  dueDate: new Date('2026-10-15T00:00:00Z'),
  taxableSupplyDate: new Date('2026-10-01T00:00:00Z'),
  totalAmount: 1331,
  variableSymbol: '20260042',
  supplierIco: '12345678',
  supplierDic: 'CZ12345678',
  customerIco: '87654321',
  vatLines: [
    { rate: 21, base: 1000, vat: 210 },
    { rate: 12, base: 100, vat: 12 },
    { rate: 0, base: 9, vat: 0 }
  ],
  iban: 'CZ6508000000192000145399'
});

describe('generateQrInvoiceString', () => {
  it('emits the SID fields with the VAT recap per rate slot', () => {
    expect(sid.startsWith('SID*1.0*ID:2026-0042*DD:20261001*AM:1331.00*TP:0*TD:9*SA:0*')).toBe(true);
    expect(sid).toContain('*TB0:1000.00*T0:210.00*TB1:100.00*T1:12.00*NTB:9.00*CC:CZK*');
    expect(sid).toContain('*INI:12345678*');
  });

  it('marks a non-VAT-payer document as nedaňový doklad', () => {
    expect(generateQrInvoiceString({ invoiceNumber: '1', issueDate: new Date('2026-01-02T00:00:00Z'), totalAmount: 5 })).toContain('*TD:0*');
  });
});

describe('parseInvoiceQr', () => {
  it('round-trips QR Platba + Faktura', () => {
    const spayd = generateSpaydString({ iban: 'CZ6508000000192000145399', amount: 1331, variableSymbol: '20260042', invoice: qrInvoiceForSpayd(sid) });
    expect(spayd).toContain('*X-INV:SID%2A1.0%2AID:2026-0042%2A');
    expect(parseInvoiceQr(spayd)).toMatchObject({
      format: 'spayd+sid',
      invoiceNumber: '2026-0042',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      amount: 1331,
      variableSymbol: '20260042',
      supplierIco: '12345678',
      supplierDic: 'CZ12345678',
      iban: 'CZ6508000000192000145399',
      baseAmount: 1109,
      vatAmount: 222,
      vatRate: 21,
      taxDocument: true
    });
  });

  it('reads a plain QR Platba and rejects unrelated codes', () => {
    expect(parseInvoiceQr('SPD*1.0*ACC:CZ6508000000192000145399*AM:450.00*CC:CZK*X-VS:123*MSG:Faktura 7')).toMatchObject({
      format: 'spayd',
      amount: 450,
      variableSymbol: '123',
      message: 'Faktura 7'
    });
    expect(parseInvoiceQr('https://example.com')).toBeNull();
  });
});
