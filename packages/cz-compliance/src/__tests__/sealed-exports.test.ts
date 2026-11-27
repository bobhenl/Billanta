import { describe, expect, it } from 'vitest';
import {
  buildCzVatFiling,
  buildSealedInvoicesCsv,
  buildSealedVatFiling,
  buildSkVatFiling,
  invoicesCsvBody,
  sealedEnvelopesOf,
  skSubmitterFromTenant,
  submitterFromTenant,
  vatPartsOf,
  type CsvInvoice,
  type DocumentAmounts,
  type FilingIssuedDoc,
  type SealedCsvInputs,
  type SealedVatInputs,
  type SealedVatIssuedDoc,
} from '../index.js';

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAA${n}:${'Q'.repeat(24)}`;
const amounts = (base21: number, base12 = 0): DocumentAmounts => {
  const byRate = [
    { vatRatePercent: 21, totalWithoutVat: base21, vatAmount: base21 * 0.21, totalWithVat: base21 * 1.21 },
    ...(base12 ? [{ vatRatePercent: 12, totalWithoutVat: base12, vatAmount: base12 * 0.12, totalWithVat: base12 * 1.12 }] : []),
  ];
  const sum = (k: 'totalWithoutVat' | 'vatAmount' | 'totalWithVat') => byRate.reduce((a, r) => a + r[k], 0);
  return { totalWithoutVat: sum('totalWithoutVat'), totalVat: sum('vatAmount'), totalWithVat: sum('totalWithVat'), byRate };
};
const wire = <T,>(v: T) => JSON.parse(JSON.stringify(v));

describe('buildSealedInvoicesCsv', () => {
  const invoice = (over: Partial<CsvInvoice>): CsvInvoice => ({
    invoiceNumber: '2026001',
    documentType: 'invoice',
    status: 'issued',
    issueDate: new Date(2026, 2, 2),
    taxableSupplyDate: null,
    dueDate: new Date(2026, 2, 16),
    paidAt: null,
    currency: 'CZK',
    exchangeRate: null,
    variableSymbol: '2026001',
    language: 'cs',
    reverseCharge: false,
    amountPaid: '0',
    customFields: [{ label: 'Provize', value: '10', kind: 'percent' }],
    internalNote: null,
    ...over,
  });
  const contact = { legalName: 'Alfa s.r.o.', ico: '12345678', dic: 'CZ12345678' };
  const inputs = (): SealedCsvInputs =>
    wire({
      home: 'CZK',
      companyVars: [],
      rows: [
        { invoice: invoice({}), contact, totals: amounts(1000), encAmounts: null },
        { invoice: invoice({ invoiceNumber: '2026002', currency: 'EUR', exchangeRate: '25' }), contact: null, totals: null, encAmounts: env(1) },
        { invoice: invoice({ invoiceNumber: '2026003' }), contact, totals: amounts(10), encAmounts: null },
      ],
    });

  it('gives the file the server would give with the sealed document in plain, in the same order', () => {
    const out = buildSealedInvoicesCsv(inputs(), new Map([[env(1), amounts(400, 100)]]));
    const plain = invoicesCsvBody([
      { invoice: invoice({}), contact, totals: amounts(1000) },
      { invoice: invoice({ invoiceNumber: '2026002', currency: 'EUR', exchangeRate: '25' }), contact: null, totals: amounts(400, 100) },
      { invoice: invoice({ invoiceNumber: '2026003' }), contact, totals: amounts(10) },
    ]);
    expect(out).toEqual({ body: plain, missing: 0 });
    // The opened rate groups get their own columns; the custom field is computed from the opened base.
    expect(out.body).toContain('Základ 12 %');
    expect(out.body).toContain('2026002;Faktura;2.3.2026;2.3.2026;16.3.2026;;;;;EUR;400,00;84,00;100,00;12,00;500,00;96,00;596,00;25;14900,00');
    expect(out.body).toContain('Provize: 10 % (50,00)');
  });

  it('builds nothing while a sealed document stays shut', () => {
    expect(buildSealedInvoicesCsv(inputs(), new Map())).toEqual({ body: null, missing: 1 });
  });

  it('lists the envelopes to open', () => {
    expect(sealedEnvelopesOf(inputs())).toEqual([env(1)]);
    expect(sealedEnvelopesOf({ issued: [{ encAmounts: null }, { encAmounts: env(2) }, {}] })).toEqual([env(2)]);
  });

  it('takes the opened totals over any the server sent with an envelope', () => {
    const stale = inputs();
    stale.rows[1]!.totals = amounts(0);
    expect(buildSealedInvoicesCsv(stale, new Map([[env(1), amounts(400, 100)]])).body).toContain(';EUR;400,00;84,00;100,00;12,00;');
  });

  it('computes custom-field formulas with the company variables', () => {
    const withVars = inputs();
    withVars.companyVars = [{ key: 'sazba', value: '2' }];
    withVars.rows[1]!.invoice.customFields = [{ label: 'Odměna', value: '{base} * {sazba}', kind: 'formula' }];
    expect(buildSealedInvoicesCsv(withVars, new Map([[env(1), amounts(400, 100)]])).body).toContain('Odměna: 1000,00');
  });
});

describe('buildSealedVatFiling', () => {
  const submitter = submitterFromTenant({
    legalName: 'Jan Novák',
    dic: 'CZ8001011234',
    addressStreet: 'Masarykova 12/3a',
    addressCity: 'Brno',
    addressPostalCode: '602 00',
    addressCountry: 'CZ',
    email: 'jan@example.cz',
    phone: null,
  });
  const period = { year: 2026, month: 9 };
  const today = new Date(2026, 9, 10);
  const doc = (over: Partial<FilingIssuedDoc>): FilingIssuedDoc => ({
    number: '2026-001',
    customerDic: 'CZ12345678',
    customerCountry: 'CZ',
    taxableDate: new Date(2026, 8, 15),
    reverseCharge: false,
    reverseChargeCode: null,
    ...vatPartsOf(amounts(2000), 1),
    correctsNumber: null,
    ...over,
  });
  const sealedDoc = (over: Partial<SealedVatIssuedDoc> = {}): SealedVatIssuedDoc =>
    wire({ ...doc({ number: '2026-002', customerDic: 'CZ87654321', taxableDate: new Date(2026, 8, 30, 23, 59) }), parts: [], totalCzk: 0, encAmounts: env(1), rate: 25, ...over });
  const czInputs = (kind: 'dp3' | 'kh1' | 'shv', issued: SealedVatIssuedDoc[]): SealedVatInputs =>
    wire({ country: 'CZ', kind, identified: false, submitter, period, issued, received: [] });
  const opened = new Map([[env(1), amounts(800)]]);
  // 800 EUR at 25 CZK: 20 000 CZK base, above the KH itemizing threshold.
  const asPlain = doc({ number: '2026-002', customerDic: 'CZ87654321', taxableDate: new Date(2026, 8, 30, 23, 59), ...vatPartsOf(amounts(800), 25) });

  for (const kind of ['dp3', 'kh1', 'shv'] as const) {
    it(`gives the ${kind} the server would give with the sealed document in plain`, () => {
      const out = buildSealedVatFiling(czInputs(kind, [wire(doc({})), sealedDoc()]), opened, today);
      const expected = buildCzVatFiling(kind, { issued: [doc({}), asPlain], received: [], submitter, period, identified: false, today });
      expect(out).toEqual({ ...expected, missing: 0 });
    });
  }

  it('converts the opened document at the rate the server sent and itemizes it in KH', () => {
    const out = buildSealedVatFiling(czInputs('kh1', [sealedDoc()]), opened, today);
    expect(out.body).toContain('c_evid_dd="2026-002" dppd="30.09.2026" zakl_dane1="20000" dan1="4200"');
  });

  it('builds nothing while a sealed document stays shut or has no rate', () => {
    expect(buildSealedVatFiling(czInputs('dp3', [sealedDoc()]), new Map(), today)).toEqual({ body: null, warnings: [], missing: 1 });
    expect(buildSealedVatFiling(czInputs('dp3', [sealedDoc({ rate: undefined })]), opened, today)).toMatchObject({ body: null, missing: 1 });
  });

  it('keeps the identified-person return for an identified person', () => {
    const eu = (o: Partial<SealedVatIssuedDoc>) => sealedDoc({ customerDic: 'DE123456789', customerCountry: 'DE', ...o });
    const inputs: SealedVatInputs = { ...czInputs('dp3', [eu({})]), identified: true } as SealedVatInputs;
    const out = buildSealedVatFiling(inputs, opened, today);
    const plainEu = { ...asPlain, customerDic: 'DE123456789', customerCountry: 'DE' };
    expect(out).toEqual({ ...buildCzVatFiling('dp3', { issued: [plainEu], received: [], submitter, period, identified: true, today }), missing: 0 });
    expect(out.body).not.toEqual(buildCzVatFiling('dp3', { issued: [plainEu], received: [], submitter, period, identified: false, today }).body);
  });

  it('builds the Slovak control statement with the corrected invoice of a sealed credit note', () => {
    const sk = skSubmitterFromTenant({ legalName: 'Alfa s.r.o.', dic: 'SK2020123456', addressStreet: 'Hlavná 12', addressCity: 'Bratislava', addressPostalCode: '811 01', email: null, phone: null });
    const credit = sealedDoc({ customerDic: 'SK2020654321', customerCountry: 'SK', correctsNumber: '2026-001', rate: 1 });
    const inputs = wire({ country: 'SK', kind: 'kv', submitter: sk, period, issued: [credit], received: [] }) as SealedVatInputs;
    const negative = new Map([[env(1), amounts(-800)]]);
    const out = buildSealedVatFiling(inputs, negative, today);
    const plain = { ...asPlain, customerDic: 'SK2020654321', customerCountry: 'SK', correctsNumber: '2026-001', ...vatPartsOf(amounts(-800), 1) };
    expect(out).toEqual({ body: buildSkVatFiling('kv', { issued: [plain], received: [], submitter: sk, period }), warnings: [], missing: 0 });
    expect(out.body).toContain('2026-001');
  });
});
