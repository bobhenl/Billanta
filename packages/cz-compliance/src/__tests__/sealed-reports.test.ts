import { describe, expect, it } from 'vitest';
import { mergeSealedStats, mergeSealedSummary, periodReport, type DocumentAmounts, type SealedStatsInputs, type SealedSummaryDoc, type StatsDoc } from '../index.js';

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAA${n}:${'Q'.repeat(24)}`;
const amounts = (base: number, vat: number): DocumentAmounts => ({ totalWithoutVat: base, totalVat: vat, totalWithVat: base + vat, byRate: [] });

describe('mergeSealedSummary', () => {
  const kpi = { revenueMonth: 100, revenueYear: 1000, vatMonth: 21, unpaidTotal: 50, unpaidCount: 2, overdueTotal: 10, overdueCount: 1, expensesMonth: 30, profitMonth: 70, dueSoonTotal: 5 };
  const chart = [
    { month: '2026-10', revenue: 0, expenses: 0 },
    { month: '2026-11', revenue: 100, expenses: 30 },
  ];
  const customers = [
    { contactId: 'a', name: 'A', total: 900, count: 3 },
    { contactId: 'b', name: 'B', total: 100, count: 1 },
    { contactId: 'c', name: 'C', total: 90, count: 1 },
    { contactId: 'd', name: 'D', total: 80, count: 1 },
    { contactId: 'e', name: 'E', total: 70, count: 1 },
    { contactId: 'f', name: 'F', total: 60, count: 1 },
  ];
  const doc = (over: Partial<SealedSummaryDoc>): SealedSummaryDoc => ({
    id: 'x',
    encAmounts: env(1),
    contactId: 'f',
    contactName: 'F',
    amountPaid: 0,
    unpaid: false,
    overdue: false,
    dueSoon: false,
    taxDoc: true,
    inMonth: true,
    inYear: true,
    month: '2026-11',
    ...over,
  });

  it('adds an opened invoice to revenue, VAT, profit, the chart and its customer', () => {
    const out = mergeSealedSummary({ kpi, chart, customers }, [doc({})], new Map([[env(1), amounts(1000, 210)]]));
    expect(out.kpi).toMatchObject({ revenueMonth: 1100, vatMonth: 231, revenueYear: 2000, profitMonth: 1070, unpaidTotal: 50 });
    expect(out.chart[1]!.revenue).toBe(1100);
    expect(out.chart[0]!.revenue).toBe(0);
    // F climbs from sixth to first: the full customer list, not the server's top five.
    expect(out.topCustomers.map((c) => c.contactId)).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(out.topCustomers[0]).toMatchObject({ total: 1060, count: 2 });
    expect(out.missing).toBe(0);
  });

  it('counts the unpaid rest after partial payments, overdue and due soon included', () => {
    const out = mergeSealedSummary(
      { kpi, chart, customers },
      [doc({ unpaid: true, overdue: true, amountPaid: 210, taxDoc: false }), doc({ encAmounts: env(2), unpaid: true, dueSoon: true, taxDoc: false })],
      new Map([
        [env(1), amounts(1000, 210)],
        [env(2), amounts(100, 21)],
      ]),
    );
    expect(out.kpi).toMatchObject({ unpaidTotal: 1171, overdueTotal: 1010, dueSoonTotal: 126, revenueMonth: 100 });
  });

  it('keeps revenue outside this month out of the month cards', () => {
    const out = mergeSealedSummary({ kpi, chart, customers }, [doc({ inMonth: false, month: '2026-10' })], new Map([[env(1), amounts(1000, 210)]]));
    expect(out.kpi).toMatchObject({ revenueMonth: 100, vatMonth: 21, revenueYear: 2000 });
    expect(out.chart[0]!.revenue).toBe(1000);
  });

  it('leaves a document it cannot open out and counts it', () => {
    const out = mergeSealedSummary({ kpi, chart, customers }, [doc({ encAmounts: env(9) })], new Map());
    expect(out.kpi).toMatchObject({ revenueMonth: 100, revenueYear: 1000 });
    expect(out.missing).toBe(1);
  });
});

describe('mergeSealedStats', () => {
  const plain: StatsDoc = {
    documentType: 'invoice',
    status: 'paid',
    currency: 'CZK',
    language: 'cs',
    date: new Date(2026, 9, 10),
    issueDate: new Date(2026, 9, 10),
    dueDate: new Date(2026, 9, 24),
    paidAt: new Date(2026, 9, 20),
    contactId: 'a',
    contactName: 'A',
    exchangeRate: null,
    amountPaid: 0,
    base: 1000,
    vat: 210,
    total: 1210,
  };
  const wire = <T extends object>(v: T) => JSON.parse(JSON.stringify(v));
  const from = new Date(2026, 9, 1);
  const end = new Date(2026, 10, 1);
  const inputs = (sealedDate: Date): SealedStatsInputs =>
    wire({
      home: 'CZK',
      previousFrom: new Date(2026, 8, 1).toISOString(),
      docs: [plain],
      sealedDocs: [{ ...plain, base: undefined, vat: undefined, total: undefined, id: 's1', encAmounts: env(1), contactId: 'b', contactName: 'B', status: 'issued', paidAt: null, date: sealedDate, issueDate: sealedDate }],
      expenses: [{ currency: 'CZK', date: new Date(2026, 9, 5), base: 300, exchangeRate: null }],
    });
  const opts = { from: from.toISOString(), to: new Date(end.getTime() - 1).toISOString(), currency: 'CZK', filters: {}, today: new Date(2026, 10, 15) };

  it('gives the report the server would give with the sealed document in plain', () => {
    const merged = mergeSealedStats(inputs(new Date(2026, 9, 12)), new Map([[env(1), amounts(500, 105)]]), opts);
    const sealedPlain = { ...plain, contactId: 'b', contactName: 'B', status: 'issued', paidAt: null, date: new Date(2026, 9, 12), issueDate: new Date(2026, 9, 12), base: 500, vat: 105, total: 605 };
    const expected = periodReport([plain, sealedPlain], [{ currency: 'CZK', date: new Date(2026, 9, 5), base: 300, exchangeRate: null }], {
      from,
      to: end,
      previousFrom: new Date(2026, 8, 1),
      currency: 'CZK',
      home: 'CZK',
      filters: {},
      today: opts.today,
    });
    expect(merged).toEqual({ ...expected, missing: 0 });
    expect(merged.current).toMatchObject({ revenue: 1500, vat: 315, invoiceCount: 2, outstanding: 605, overdue: 605, customerCount: 2, profit: 1200 });
  });

  it('puts a sealed document of the previous period into the comparison only', () => {
    const merged = mergeSealedStats(inputs(new Date(2026, 8, 12)), new Map([[env(1), amounts(500, 105)]]), opts);
    expect(merged.current.revenue).toBe(1000);
    expect(merged.previous.revenue).toBe(500);
  });

  it('counts a document from the last millisecond of the period', () => {
    const merged = mergeSealedStats(inputs(new Date(end.getTime() - 1)), new Map([[env(1), amounts(500, 105)]]), opts);
    expect(merged.current.revenue).toBe(1500);
  });

  it('applies the report filters to the sealed documents too', () => {
    const merged = mergeSealedStats(inputs(new Date(2026, 9, 12)), new Map([[env(1), amounts(500, 105)]]), { ...opts, filters: { contactId: 'a' } });
    expect(merged.current.revenue).toBe(1000);
  });

  it('leaves out what it cannot open and says how many', () => {
    const merged = mergeSealedStats(inputs(new Date(2026, 9, 12)), new Map(), opts);
    expect(merged.current.revenue).toBe(1000);
    expect(merged.missing).toBe(1);
  });
});
