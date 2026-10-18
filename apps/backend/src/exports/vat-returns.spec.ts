import { describe, expect, it } from "vitest";
import { parseCnbRates } from "./cnb-rates";
import {
  classifyIssued,
  generateDphDp3,
  generateDphKh1,
  generateDphShv,
  submitterFromTenant,
  type VatIssuedDoc,
  type VatReceivedDoc,
} from "./vat-returns";

const submitter = submitterFromTenant({
  legalName: "Jan Novák",
  dic: "CZ8001011234",
  addressStreet: "Masarykova 12/3a",
  addressCity: "Brno",
  addressPostalCode: "602 00",
  addressCountry: "CZ",
  email: "jan@example.cz",
  phone: null,
});
const period = { year: 2026, month: 9 };
const today = new Date(2026, 9, 10);
const d = new Date(2026, 8, 15);

const issued = (o: Partial<VatIssuedDoc>): VatIssuedDoc => ({
  number: "2026-001",
  customerDic: "CZ12345678",
  customerCountry: "CZ",
  taxableDate: d,
  reverseCharge: false,
  reverseChargeCode: null,
  parts: [{ ratePercent: 21, base: 20000, vat: 4200 }],
  totalCzk: 24200,
  ...o,
});
const received = (o: Partial<VatReceivedDoc>): VatReceivedDoc => ({
  number: "FV-9",
  supplierDic: "CZ87654321",
  taxableDate: d,
  parts: [{ ratePercent: 21, base: 10000, vat: 2100 }],
  totalCzk: 12100,
  ...o,
});

describe("submitterFromTenant", () => {
  it("splits a natural person's name and the street numbers", () => {
    expect(submitter).toMatchObject({ typDs: "F", jmeno: "Jan", prijmeni: "Novák", ulice: "Masarykova", cPop: "12", cOrient: "3a" });
  });
  it("recognises a legal person by its legal form", () => {
    const s = submitterFromTenant({ ...{ legalName: "Acme s.r.o.", dic: "CZ1", addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ", email: null, phone: null } });
    expect(s.typDs).toBe("P");
    expect(s.nazevPravOsoby).toBe("Acme s.r.o.");
  });
});

describe("classifyIssued", () => {
  it("routes by customer DIČ and reverse charge", () => {
    expect(classifyIssued(issued({}))).toBe("domestic");
    expect(classifyIssued(issued({ reverseCharge: true }))).toBe("domestic_reverse");
    expect(classifyIssued(issued({ customerDic: "DE123456789", customerCountry: "DE" }))).toBe("eu");
    expect(classifyIssued(issued({ customerDic: null, customerCountry: "DE" }))).toBe("domestic");
    expect(classifyIssued(issued({ customerDic: null, customerCountry: "US" }))).toBe("export");
  });
});

describe("generateDphDp3", () => {
  it("sums output and input VAT per rate and computes the tax due", () => {
    const xml = generateDphDp3({
      issued: [
        issued({}),
        issued({ number: "2026-002", parts: [{ ratePercent: 12, base: 1000, vat: 120 }], totalCzk: 1120 }),
        issued({ number: "2026-003", customerDic: "SK2020123456", customerCountry: "SK", parts: [{ ratePercent: 0, base: 5000, vat: 0 }] }),
      ],
      received: [received({})],
      submitter,
      period,
      today,
    });
    expect(xml).toContain('<Veta1 obrat23="20000" dan23="4200" obrat5="1000" dan5="120" />');
    expect(xml).toContain('<Veta2 pln_sluzby="5000" />');
    expect(xml).toContain('<Veta4 pln23="10000" odp_tuz23_nar="2100" odp_sum_nar="2100" />');
    expect(xml).toContain('<Veta6 dan_zocelk="4320" odp_zocelk="2100" dano_da="2220" dano_no="0" />');
    expect(xml).toContain('mesic="9"');
    expect(xml).toContain('d_poddp="10.10.2026"');
    expect(xml).toContain('dic="8001011234"');
  });
  it("reports an excess deduction", () => {
    const xml = generateDphDp3({ issued: [], received: [received({})], submitter, period: { year: 2026, quarter: 3 }, today });
    expect(xml).toContain('dano_da="0" dano_no="2100"');
    expect(xml).toContain('ctvrt="3"');
  });
});

describe("generateDphKh1", () => {
  it("itemizes documents over 10 000 CZK and aggregates the rest", () => {
    const { xml, warnings } = generateDphKh1({
      issued: [
        issued({}),
        issued({ number: "small", parts: [{ ratePercent: 21, base: 1000, vat: 210 }], totalCzk: 1210 }),
        issued({ number: "rc", reverseCharge: true, reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 50000, vat: 0 }], totalCzk: 50000 }),
      ],
      received: [received({}), received({ number: "small-in", parts: [{ ratePercent: 21, base: 100, vat: 21 }], totalCzk: 121 })],
      submitter,
      period,
      today,
    });
    expect(xml).toContain('<VetaA1 c_radku="1" dic_odb="12345678" c_evid_dd="rc" duzp="15.09.2026" zakl_dane1="50000" kod_pred_pl="4" />');
    expect(warnings).toEqual([]);
    expect(xml).toMatch(/<VetaA4 c_radku="1" dic_odb="12345678" c_evid_dd="2026-001" [^>]*zakl_dane1="20000" dan1="4200"/);
    expect(xml).toContain('<VetaA5 zakl_dane1="1000" dan1="210" zakl_dane2="0" dan2="0" />');
    expect(xml).toMatch(/<VetaB2 c_radku="1" dic_dod="87654321" c_evid_dd="FV-9"/);
    expect(xml).toContain('<VetaB3 zakl_dane1="100" dan1="21" zakl_dane2="0" dan2="0" />');
    expect(xml).toContain('<VetaC obrat23="21000" obrat5="0" pln23="10100" pln5="0" pln_rez_pren="50000" />');
  });
  it("escapes document numbers", () => {
    const { xml } = generateDphKh1({ issued: [issued({ number: 'A&"B' })], received: [], submitter, period, today });
    expect(xml).toContain('c_evid_dd="A&amp;&quot;B"');
  });
  it("writes each reverse-charge document's own kód předmětu plnění", () => {
    const rc = { reverseCharge: true, parts: [{ ratePercent: 21, base: 30000, vat: 0 }], totalCzk: 30000 };
    const { xml } = generateDphKh1({
      issued: [issued({ ...rc, number: "rc-gold", reverseChargeCode: "1a" }), issued({ ...rc, number: "rc-phones", reverseChargeCode: "14" })],
      received: [],
      submitter,
      period,
      today,
    });
    expect(xml).toMatch(/<VetaA1 c_radku="1" [^>]*c_evid_dd="rc-gold" [^>]*kod_pred_pl="1a" \/>/);
    expect(xml).toMatch(/<VetaA1 c_radku="2" [^>]*c_evid_dd="rc-phones" [^>]*kod_pred_pl="14" \/>/);
  });
  it("warns instead of inventing a code when a reverse-charge document has none", () => {
    const { xml, warnings } = generateDphKh1({
      issued: [
        issued({ number: "rc-ok", reverseCharge: true, reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 30000, vat: 0 }], totalCzk: 30000 }),
        issued({ number: "rc-nocode", reverseCharge: true, parts: [{ ratePercent: 21, base: 7000, vat: 0 }], totalCzk: 7000 }),
      ],
      received: [],
      submitter,
      period,
      today,
    });
    expect(warnings).toEqual([{ code: "reverse_charge_code_missing", document: "rc-nocode" }]);
    // The row is still there for review in EPO, just without a made-up code.
    expect(xml).toContain('<VetaA1 c_radku="2" dic_odb="12345678" c_evid_dd="rc-nocode" duzp="15.09.2026" zakl_dane1="7000" />');
    expect(xml.match(/kod_pred_pl=/g)).toHaveLength(1);
    expect(xml).toContain('pln_rez_pren="37000"');
  });
  it("warns about a reverse-charge document without the customer's DIČ", () => {
    const { xml, warnings } = generateDphKh1({
      issued: [issued({ number: "rc-nodic", customerDic: null, reverseCharge: true, reverseChargeCode: "4" })],
      received: [],
      submitter,
      period,
      today,
    });
    expect(warnings).toEqual([{ code: "reverse_charge_dic_missing", document: "rc-nodic" }]);
    expect(xml).not.toContain("<VetaA1");
  });
});

describe("generateDphShv", () => {
  it("groups EU supplies per customer VAT ID", () => {
    const eu = { customerDic: "DE123456789", customerCountry: "DE", parts: [{ ratePercent: 0, base: 3000, vat: 0 }] };
    const xml = generateDphShv({ issued: [issued(eu), issued({ ...eu, number: "x" }), issued({})], submitter, period, today })!;
    expect(xml).toContain('k_stat="DE" c_vat="123456789" k_pln_eu="3" pln_pocet="2" pln_hodnota="6000"');
    expect(xml.match(/<VetaR /g)).toHaveLength(1);
  });
  it("returns null with nothing to report", () => {
    expect(generateDphShv({ issued: [issued({})], submitter, period, today })).toBeNull();
  });
});

describe("parseCnbRates", () => {
  it("divides by the quoted amount", () => {
    const rates = parseCnbRates("01.10.2026 #190\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,330\nJaponsko|jen|100|JPY|15,512\n");
    expect(rates.get("EUR")).toBe(24.33);
    expect(rates.get("JPY")).toBeCloseTo(0.15512);
  });
});
