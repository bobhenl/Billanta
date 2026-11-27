import { describe, expect, it } from 'vitest';
import {
  annualFilingLinesOf,
  annualIncomeOf,
  buildSealedAccountingXml,
  buildSealedFilingLines,
  buildSealedTaxReturn,
  buildSealedYearIncome,
  computeOsvcAnnualSummary,
  FILING_PERSON_PATTERNS,
  generateDpfdp,
  mergeSealedIncome,
  moneyS3Xml,
  pohodaXml,
  sealedAccountingEnvelopes,
  sealedIncomeEnvelopes,
  taxReturnCsv,
  taxReturnReportOf,
  type AccountingDoc,
  type AccountingExpense,
  type AnnualFilingsInputs,
  type DocumentAmounts,
  type FilingPerson,
  type ItemAmounts,
  type SealedAccountingInputs,
  type TaxReturnInputs,
} from '../index.js';

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAA${n}:${'Q'.repeat(24)}`;
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const amounts = (base: number, rate = 21): DocumentAmounts => ({
  totalWithoutVat: base,
  totalVat: (base * rate) / 100,
  totalWithVat: base * (1 + rate / 100),
  byRate: [{ vatRatePercent: rate, totalWithoutVat: base, vatAmount: (base * rate) / 100, totalWithVat: base * (1 + rate / 100) }],
});

describe('buildSealedAccountingXml', () => {
  const invoice = (number: string, over: Partial<AccountingDoc['invoice']> = {}): AccountingDoc['invoice'] => ({
    invoiceNumber: number,
    documentType: 'invoice',
    variableSymbol: number,
    constantSymbol: null,
    specificSymbol: null,
    issueDate: new Date(2026, 2, 2),
    taxableSupplyDate: null,
    dueDate: new Date(2026, 2, 16),
    paymentMethod: 'bank_transfer',
    noteBelow: null,
    internalNote: null,
    currency: 'CZK',
    exchangeRate: null,
    reverseCharge: false,
    ...over,
  });
  const contact = { legalName: 'Alfa s.r.o.', addressStreet: 'Dlouhá 1', addressCity: 'Praha', addressPostalCode: '11000', addressCountry: 'CZ', ico: '12345678', dic: 'CZ12345678' };
  const item = (description: string, quantity: number, unitPrice: number, vatRate: number | null, discountPercent = 0) => ({
    description,
    unit: 'h',
    quantity: String(quantity),
    unitPrice: String(unitPrice),
    vatRate: vatRate == null ? null : String(vatRate),
    discountPercent: String(discountPercent),
  });
  const placeholder = (description: string) => item(description, 1, 0, null);
  const expense: AccountingExpense = {
    id: 'e0000000-1',
    documentNumber: 'FP-7',
    variableSymbol: null,
    expenseDate: new Date(2026, 2, 5),
    dueDate: null,
    description: 'Hosting',
    supplierNameRaw: 'Host s.r.o.',
    supplierIco: null,
    note: null,
    vatRate: '21',
    amount: '1210',
    currency: 'CZK',
    reverseCharge: false,
  };
  const sealedItem: ItemAmounts = { quantity: 3, unitPrice: 1500, vatRate: 12, discountPercent: 10 };
  const sealedTotals = amounts(4050, 12);

  const inputs = (format: SealedAccountingInputs['format']): SealedAccountingInputs =>
    wire({
      format,
      period: { from: new Date(2026, 2, 1).toISOString(), to: new Date(2026, 3, 1).toISOString() },
      ico: '87654321',
      home: 'CZK',
      invoices: [
        { invoice: invoice('2026001'), contact, lineItems: [{ ...item('Vývoj', 10, 100, 21), encAmounts: null }], totals: amounts(1000), encAmounts: null },
        {
          invoice: invoice('2026002', { currency: 'EUR', exchangeRate: '25' }),
          contact,
          lineItems: [{ ...placeholder('Konzultace'), encAmounts: env(2) }],
          totals: null,
          encAmounts: env(1),
        },
      ],
      expenses: [expense],
    });
  const plainFile = () => ({
    period: { from: new Date(2026, 2, 1), to: new Date(2026, 3, 1) },
    ico: '87654321',
    home: 'CZK' as const,
    invoices: [
      { invoice: invoice('2026001'), contact, lineItems: [item('Vývoj', 10, 100, 21)], totals: amounts(1000) },
      { invoice: invoice('2026002', { currency: 'EUR', exchangeRate: '25' }), contact, lineItems: [item('Konzultace', 3, 1500, 12, 10)], totals: sealedTotals },
    ],
    expenses: [expense],
    today: new Date(2026, 3, 2),
  });
  const docs = new Map([[env(1), sealedTotals]]);
  const items = new Map([[env(2), sealedItem]]);

  it('gives the Pohoda file the server would give with the sealed document in plain', () => {
    const out = buildSealedAccountingXml(inputs('pohoda'), docs, items, new Date(2026, 3, 2));
    expect(out).toEqual({ body: pohodaXml(plainFile()), missing: 0 });
    expect(out.body).toContain('<inv:percentVAT>12</inv:percentVAT><inv:discountPercentage>10</inv:discountPercentage>');
  });

  it('gives the Money S3 file the server would give, with the opened totals in the header', () => {
    const out = buildSealedAccountingXml(inputs('money-s3'), docs, items, new Date(2026, 3, 2));
    expect(out).toEqual({ body: moneyS3Xml(plainFile()), missing: 0 });
    expect(out.body).toContain('<Zaklad5>4050.00</Zaklad5>');
    expect(out.body).toContain('<Valuty>1350</Valuty>');
  });

  it('builds nothing while the totals or a line of a sealed document stay shut', () => {
    expect(buildSealedAccountingXml(inputs('pohoda'), new Map(), items)).toEqual({ body: null, missing: 1 });
    expect(buildSealedAccountingXml(inputs('money-s3'), docs, new Map())).toEqual({ body: null, missing: 1 });
  });

  it('lists the envelopes to open', () => {
    expect(sealedAccountingEnvelopes(inputs('pohoda'))).toEqual({ documents: [env(1)], items: [env(2)] });
  });
});

describe('sealed annual income', () => {
  const year = (over: Partial<TaxReturnInputs> = {}): TaxReturnInputs =>
    wire({
      vatPayer: true,
      plainIncome: 100_000,
      counts: { invoices: 2, expenses: 1, missingRates: 0 },
      sealedDocs: [
        { encAmounts: env(1), documentType: 'invoice', rate: 25 },
        { encAmounts: env(2), documentType: 'credit_note', rate: 1 },
        { encAmounts: env(3), documentType: 'invoice', rate: null },
      ],
      country: 'CZ',
      year: 2025,
      legalEntity: false,
      flatRate: 60,
      expensesByCategory: { software: 20_000 },
      companyName: 'Jan Novák',
      basis: 'cash',
      flatTaxRegime: false,
      ...over,
    });
  const opened = new Map([
    [env(1), amounts(2_000)],
    [env(2), amounts(5_000)],
    [env(3), amounts(9_999)],
  ]);

  it('adds the opened documents with the server formula: rate, credit note subtracted, a missing rate left out', () => {
    const merged = mergeSealedIncome(year(), opened);
    expect(merged.income).toBe(100_000 + 2_000 * 25 - 5_000);
    expect(merged.counts).toEqual({ invoices: 5, expenses: 1, missingRates: 1 });
    expect(merged.missing).toBe(0);
  });

  it('counts income with VAT for a non-payer', () => {
    expect(annualIncomeOf(amounts(1000), 'invoice', 2, false)).toBeCloseTo(2420);
    expect(annualIncomeOf(amounts(1000), 'credit_note', 1, true)).toBe(-1000);
  });

  it('gives the report the server gives for the same income', () => {
    const { report } = buildSealedTaxReturn(year(), opened);
    expect(report).toEqual(taxReturnReportOf(year(), 145_000, { invoices: 5, expenses: 1, missingRates: 1 }));
    expect(report!.income).toBe(145_000);
    expect(taxReturnCsv(report!)).toContain('145');
  });

  it('builds no report while a sealed document stays shut', () => {
    const partial = new Map([[env(1), amounts(2_000)]]);
    expect(buildSealedTaxReturn(year(), partial)).toEqual({ report: null, missing: 2 });
  });

  it('lists the envelopes to open', () => {
    expect(sealedIncomeEnvelopes(year())).toEqual([env(1), env(2), env(3)]);
  });

  it('gives the year summary the income the server reports for the same documents', () => {
    const out = buildSealedYearIncome(year({ plainIncome: 100_000.004 }), opened);
    expect(out.income).toBe(computeOsvcAnnualSummary({ year: 2025, income: 145_000.004, actualExpenses: 0, flatRate: null }).income);
    expect(out.income).toBe(145_000);
    expect(out.counts).toEqual({ invoices: 5, expenses: 1, missingRates: 1 });
    expect(buildSealedYearIncome(year({ plainIncome: -60_000 }), opened).income).toBe(0);
  });

  it('gives the year summary no income while a sealed document stays shut', () => {
    expect(buildSealedYearIncome(year(), new Map([[env(1), amounts(2_000)]]))).toMatchObject({ income: null, missing: 2 });
  });

  const filings = (): AnnualFilingsInputs =>
    wire({
      vatPayer: true,
      plainIncome: 400_000.004,
      counts: { invoices: 2, expenses: 0, missingRates: 0 },
      sealedDocs: [{ encAmounts: env(1), documentType: 'invoice', rate: 1 }],
      figures: { year: 2025, actualExpenses: 50_000, flatRate: 60, basis: 'cash', activity: 'H', paidSocial: 12_000, paidHealth: 8_000 },
      submitter: { dic: 'CZ8001011234', typDs: 'F', jmeno: 'Jan', prijmeni: 'Novák', nazevPravOsoby: '', obec: 'Praha', ulice: 'Dlouhá', cPop: '1', cOrient: '', psc: '11000', stat: 'ČESKÁ REPUBLIKA', email: '', telefon: '' },
      paidSource: { social: 'input', health: null },
      forms: { dpfdp: 'DPFDP7', cssz: true },
      insurers: [],
    });

  it('computes the filings from the merged income with the server function', () => {
    const out = buildSealedFilingLines(filings(), new Map([[env(1), amounts(200_000)]]));
    expect(out.missing).toBe(0);
    expect(out.lines).toEqual(annualFilingLinesOf(filings().figures, 600_000.004));
    expect(out.lines!.dpfo.rows.r101).toBe(600_000);
    expect(out.counts.invoices).toBe(3);
  });

  it('computes no filings while a sealed document stays shut', () => {
    expect(buildSealedFilingLines(filings(), new Map())).toEqual({ lines: null, counts: { invoices: 2, expenses: 0, missingRates: 0 }, missing: 1 });
  });

  it('rounds the income to the haléř before the crowns, like the year summary', () => {
    expect(annualFilingLinesOf(filings().figures, 400_000.497).dpfo.rows.r101).toBe(400_001);
    expect(annualFilingLinesOf(filings().figures, -5).dpfo.rows.r101).toBe(0);
  });

  it('writes the same DPFDP from the browser lines as from the server ones', () => {
    const lines = buildSealedFilingLines(filings(), new Map([[env(1), amounts(200_000)]])).lines!;
    const person: FilingPerson = { submitter: filings().submitter, birthNumber: '8001011234', taxOffice: 2001 };
    expect(generateDpfdp(lines.dpfo, person)).toBe(generateDpfdp(annualFilingLinesOf(filings().figures, 600_000).dpfo, person));
  });

  it('checks the filer data with the patterns the server uses', () => {
    expect(FILING_PERSON_PATTERNS.birthNumber.test('800101/1234')).toBe(true);
    expect(FILING_PERSON_PATTERNS.birthNumber.test('80-01-01')).toBe(false);
    expect(FILING_PERSON_PATTERNS.ossz.test('1234')).toBe(false);
  });
});
