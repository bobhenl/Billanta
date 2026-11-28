import { generateDpfdp, DPFDP_FORMS } from "./annual-filings.js";
import { annualFilingLinesOf } from "./sealed-annual.js";
import {
  generateDphDp3,
  generateDphDp3Identified,
  generateDphKh1,
  generateDphShv,
  submitterFromTenant,
  type VatIssuedDoc,
  type VatReceivedDoc,
} from "./vat-returns.js";

/**
 * The EPO forms Billanta exports, with the XSD the finanční správa publishes
 * for each. A daily job validates the samples below against these, so a change
 * on their side that our export no longer passes blocks the form until we fix
 * the generator. `exports` are the export routes that produce the form.
 */
export const EPO_SCHEMA_FORMS = [
  { form: "dphdp3", exports: ["dphdp3"] },
  { form: "dphkh1", exports: ["dphkh1"] },
  { form: "dphshv", exports: ["dphshv"] },
  ...DPFDP_FORMS.map((f) => ({ form: f.form.toLowerCase(), exports: ["dpfdp"] })),
].map((f) => ({ ...f, xsdUrl: `https://adisspr.mfcr.cz/adis/jepo/schema/${f.form}_epo2.xsd` }));

export type EpoSchemaForm = (typeof EPO_SCHEMA_FORMS)[number]["form"];

export interface EpoSchemaSample {
  form: string;
  /** What the sample covers, for the alert when it fails. */
  name: string;
  xml: string;
}

// Fictitious filer: the samples never carry anyone's real data.
const submitter = {
  ...submitterFromTenant({
    legalName: "Jan Novák",
    dic: "CZ8001011234",
    addressStreet: "Masarykova 12/3a",
    addressCity: "Brno",
    addressPostalCode: "602 00",
    addressCountry: "CZ",
    email: "jan@example.cz",
    phone: "+420 600 000 000",
  }),
  cUfo: 461,
  cPracufo: 3002,
};

const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d, 12));
const today = day(10, 20);

const issued = (o: Partial<VatIssuedDoc>): VatIssuedDoc => ({
  number: "2026001",
  customerDic: "CZ27082440",
  customerCountry: "CZ",
  taxableDate: day(9, 10),
  reverseCharge: false,
  reverseChargeCode: null,
  parts: [{ ratePercent: 21, base: 20_000, vat: 4_200 }],
  totalCzk: 24_200,
  ...o,
});

const received = (o: Partial<VatReceivedDoc>): VatReceivedDoc => ({
  number: "FP-1",
  supplierDic: "CZ45274649",
  taxableDate: day(9, 12),
  reverseCharge: false,
  reverseChargeCode: null,
  parts: [{ ratePercent: 21, base: 15_000, vat: 3_150 }],
  totalCzk: 18_150,
  supplierCountry: "CZ",
  ...o,
});

// Every row type the generators can emit, so a schema change in any of them shows.
const issuedDocs: VatIssuedDoc[] = [
  issued({}),
  issued({ number: "2026002", customerDic: null, parts: [{ ratePercent: 12, base: 5_000, vat: 600 }], totalCzk: 5_600 }),
  issued({ number: "2026003", reverseCharge: true, reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 40_000, vat: 0 }], totalCzk: 40_000 }),
  issued({ number: "2026004", customerDic: "DE811569869", customerCountry: "DE", parts: [{ ratePercent: 0, base: 12_000, vat: 0 }], totalCzk: 12_000 }),
];

const receivedDocs: VatReceivedDoc[] = [
  received({}),
  received({ number: "FP-2", parts: [{ ratePercent: 21, base: 2_000, vat: 420 }], totalCzk: 2_420 }),
  received({ number: "FP-3", reverseCharge: true, reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 30_000, vat: 6_300 }], totalCzk: 30_000 }),
  received({ number: "IE-1", supplierDic: "IE6388047V", supplierCountry: "IE", reverseCharge: true, parts: [{ ratePercent: 21, base: 1_000, vat: 210 }], totalCzk: 1_000 }),
];

/** Sample exports per form, built by the same generators the export routes use. */
export function epoSchemaSamples(): EpoSchemaSample[] {
  const month = { year: 2026, month: 9 };
  const quarter = { year: 2026, quarter: 3 };
  const out: EpoSchemaSample[] = [
    { form: "dphdp3", name: "DPHDP3 plátce, měsíc", xml: generateDphDp3({ issued: issuedDocs, received: receivedDocs, submitter, period: month, today }) },
    { form: "dphdp3", name: "DPHDP3 plátce, čtvrtletí", xml: generateDphDp3({ issued: issuedDocs, received: receivedDocs, submitter, period: quarter, today }) },
    { form: "dphkh1", name: "DPHKH1 měsíc", xml: generateDphKh1({ issued: issuedDocs, received: receivedDocs, submitter, period: month, today }).xml },
    { form: "dphkh1", name: "DPHKH1 čtvrtletí", xml: generateDphKh1({ issued: issuedDocs, received: receivedDocs, submitter, period: quarter, today }).xml },
  ];
  const identified = generateDphDp3Identified({ issued: [], received: receivedDocs, submitter, period: month, today }).xml;
  if (identified) out.push({ form: "dphdp3", name: "DPHDP3 identifikovaná osoba", xml: identified });
  const shv = generateDphShv({ issued: issuedDocs, submitter, period: month, today });
  if (shv) out.push({ form: "dphshv", name: "DPHSHV měsíc", xml: shv });
  for (const f of DPFDP_FORMS) {
    const year = f.years[1];
    const person = { submitter, birthNumber: "8001011234" };
    const figures = { year, actualExpenses: 50_000, flatRate: 60 as const, basis: "cash" as const, activity: "H" as const, paidSocial: 12_000, paidHealth: 8_000 };
    out.push({ form: f.form.toLowerCase(), name: `${f.form} za rok ${year}, paušál`, xml: generateDpfdp(annualFilingLinesOf(figures, 600_000).dpfo, person) });
    const actual = { ...figures, flatRate: null, actualExpenses: 250_000, taxAdvancesPaid: 5_000 };
    out.push({ form: f.form.toLowerCase(), name: `${f.form} za rok ${year}, skutečné výdaje`, xml: generateDpfdp(annualFilingLinesOf(actual, 600_000).dpfo, person) });
  }
  if (out.some((s) => !s.xml)) throw new Error("an EPO schema sample came out empty");
  return out;
}
