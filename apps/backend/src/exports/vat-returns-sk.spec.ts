import { describe, expect, it } from "vitest";
import {
  classifySkIssued,
  generateSkDphV25,
  generateSkKvDphV25,
  generateSkSvDphV20,
  skSubmitterFromTenant,
  type SkIssuedDoc,
  type SkReceivedDoc,
} from "./vat-returns-sk";

const submitter = skSubmitterFromTenant({
  legalName: "Ján Kováč & syn s.r.o.",
  dic: "SK2020123456",
  addressStreet: "Hlavná 12/3a",
  addressCity: "Košice",
  addressPostalCode: "040 01",
  email: "jan@example.sk",
  phone: null,
});
const period = { year: 2026, month: 9 };
const today = new Date(2026, 9, 10);
const d = new Date(2026, 8, 15);

const issued = (o: Partial<SkIssuedDoc>): SkIssuedDoc => ({
  number: "2026 001",
  customerVatId: "SK2021000001",
  customerCountry: "SK",
  taxableDate: d,
  reverseCharge: false,
  parts: [{ ratePercent: 23, base: 1000, vat: 230 }],
  ...o,
});
const received = (o: Partial<SkReceivedDoc>): SkReceivedDoc => ({
  number: "FV-9",
  supplierVatId: "SK2022000002",
  taxableDate: d,
  parts: [{ ratePercent: 23, base: 400, vat: 92 }],
  ...o,
});

const tag = (doc: string, name: string) => doc.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

describe("skSubmitterFromTenant", () => {
  it("splits the street and keeps the IČ DPH", () => {
    expect(submitter).toMatchObject({ icDph: "SK2020123456", ulica: "Hlavná", cislo: "12/3a", obec: "Košice" });
  });
});

describe("classifySkIssued", () => {
  it("routes by the customer's VAT ID and reverse charge", () => {
    expect(classifySkIssued(issued({}))).toBe("domestic");
    expect(classifySkIssued(issued({ reverseCharge: true }))).toBe("domestic_reverse");
    expect(classifySkIssued(issued({ customerVatId: "CZ12345678", customerCountry: "CZ" }))).toBe("eu");
    expect(classifySkIssued(issued({ customerVatId: null, customerCountry: "AT" }))).toBe("domestic");
    expect(classifySkIssued(issued({ customerVatId: null, customerCountry: "US" }))).toBe("foreign");
  });
});

describe("generateSkDphV25", () => {
  const xml = generateSkDphV25({
    issued: [
      issued({}),
      issued({ parts: [{ ratePercent: 19, base: 100, vat: 19 }, { ratePercent: 5, base: 200, vat: 10 }] }),
      // A credit note nets into the same rows.
      issued({ number: "D-1", correctsNumber: "2026 001", parts: [{ ratePercent: 23, base: -100, vat: -23 }] }),
      issued({ customerVatId: "DE123456789", customerCountry: "DE" }),
      issued({ reverseCharge: true }),
    ],
    received: [received({}), received({ supplierVatId: "CZ12345678" })],
    submitter,
    period,
    today,
  });

  it("fills the rate rows per § 27", () => {
    expect(tag(xml, "r01")).toBe("100.00");
    expect(tag(xml, "r01a")).toBe("200.00");
    expect(tag(xml, "r02")).toBe("19.00");
    expect(tag(xml, "r02a")).toBe("10.00");
    expect(tag(xml, "r03")).toBe("900.00");
    expect(tag(xml, "r04")).toBe("207.00");
    expect(tag(xml, "r17")).toBe("236.00");
  });

  it("deducts only Slovak input tax and computes the result", () => {
    expect(tag(xml, "r19")).toBe("92.00");
    expect(tag(xml, "r21")).toBe("92.00");
    expect(tag(xml, "r32")).toBe("144.00");
    expect(tag(xml, "r33")).toBe("");
    expect(tag(xml, "r35")).toBe("144.00");
  });

  it("writes the header", () => {
    expect(xml).toContain("<identifikacneCislo><kodStatu>SK</kodStatu><cislo>2020123456</cislo></identifikacneCislo>");
    expect(xml).toContain("<zdanObd><mesiac>9</mesiac><stvrtrok></stvrtrok><rok>2026</rok></zdanObd>");
    expect(xml).toContain("Kováč &amp; syn");
    expect(tag(xml, "datumVyhlasenia")).toBe("10.10.2026");
  });

  it("reports an excess deduction in r33", () => {
    const x = generateSkDphV25({ issued: [], received: [received({})], submitter, period: { year: 2026, quarter: 3 } });
    expect(tag(x, "r32")).toBe("");
    expect(tag(x, "r33")).toBe("92.00");
    expect(x).toContain("<stvrtrok>3</stvrtrok>");
  });
});

describe("generateSkKvDphV25", () => {
  it("lists invoices in A.1, A.2, B.2 and corrections in C.1", () => {
    const xml = generateSkKvDphV25({
      issued: [
        issued({}),
        issued({ customerVatId: null, number: "2026-002" }),
        issued({ reverseCharge: true, number: "2026-003" }),
        issued({ number: "D-1", correctsNumber: "2026 001", parts: [{ ratePercent: 23, base: -100, vat: -23 }] }),
        issued({ customerVatId: "DE123456789", customerCountry: "DE" }),
      ],
      received: [received({}), received({ supplierVatId: null, parts: [{ ratePercent: 19, base: 50, vat: 9.5 }] })],
      submitter,
      period,
    });
    expect(xml).toContain('<A1 Odb="SK2021000001" F="2026001" Den="2026-09-15" Z="1000.00" D="230.00" S="23" />');
    expect(xml).toContain('<A1 F="2026-002" Den="2026-09-15" Z="1000.00" D="230.00" S="23" />');
    expect(xml).toContain('<A2 Odb="SK2021000001" F="2026-003" Den="2026-09-15" Z="1000.00" />');
    expect(xml).toContain('<C1 Odb="SK2021000001" FO="2026001" FP="D-1" ZR="-100.00" DR="-23.00" S="23" />');
    expect(xml).toContain('<B2 Dod="SK2022000002" F="FV-9" Den="2026-09-15" Z="400.00" D="92.00" S="23" O="92.00" />');
    expect(xml).toContain('<B31 Z="50.00" D="9.50" O="9.50" />');
    expect(xml).not.toContain("DE123456789");
    // Transakcie keeps the XSD order A1, A2, B1, B2, B31, B32, C1…
    expect(xml.indexOf("<A2")).toBeLessThan(xml.indexOf("<B2"));
    expect(xml.indexOf("<B31")).toBeLessThan(xml.indexOf("<C1"));
  });

  it("is produced even when empty", () => {
    const xml = generateSkKvDphV25({ issued: [], received: [], submitter, period: { year: 2026, quarter: 3 } });
    expect(xml).toContain("<Stvrtrok>3</Stvrtrok>");
    expect(xml).toContain("<Transakcie></Transakcie>");
  });

  it("itemizes simplified invoices per supplier from € 3,000 of tax", () => {
    const xml = generateSkKvDphV25({
      issued: [],
      received: [
        received({ number: "", parts: [{ ratePercent: 23, base: 10000, vat: 2300 }] }),
        received({ number: "", supplierVatId: null, parts: [{ ratePercent: 23, base: 4000, vat: 920 }] }),
      ],
      submitter,
      period,
    });
    expect(xml).toContain('<B32 Dod="SK2022000002" Z="10000.00" D="2300.00" O="2300.00" />');
    expect(xml).toContain('<B31 Z="4000.00" D="920.00" O="920.00" />');
  });
});

describe("generateSkSvDphV20", () => {
  it("returns null without EU supplies", () => {
    expect(generateSkSvDphV20({ issued: [issued({})], submitter, period })).toBeNull();
  });

  it("sums per customer, in whole euros, on 12-row pages", () => {
    const xml = generateSkSvDphV20({
      issued: [
        issued({ customerVatId: "CZ12345678", customerCountry: "CZ", parts: [{ ratePercent: 0, base: 100.4, vat: 0 }] }),
        issued({ customerVatId: "CZ12345678", customerCountry: "CZ", parts: [{ ratePercent: 0, base: 200.2, vat: 0 }] }),
        issued({ customerVatId: "GR123456789", customerCountry: "GR", parts: [{ ratePercent: 0, base: 50, vat: 0 }] }),
      ],
      submitter,
      period,
      today,
    })!;
    expect(xml).toContain("<zaznam><kodStatu>CZ</kodStatu><idCislo>12345678</idCislo><hodnota>301</hodnota><kod>2</kod></zaznam>");
    expect(xml).toContain("<kodStatu>EL</kodStatu><idCislo>123456789</idCislo>");
    expect(tag(xml, "celkovaHodnota")).toBe("351");
    expect(xml.match(/<zaznam>/g)).toHaveLength(12);
    expect(xml.match(/<zaznamCast2>/g)).toHaveLength(12);
    expect(xml.match(/<riadok>/g)).toHaveLength(4);
    expect(xml).toContain("<mesiac>09</mesiac>");
  });
});
