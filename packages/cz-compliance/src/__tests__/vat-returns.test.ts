import { describe, expect, it } from "vitest";
import { parseCnbRates } from "../cnb-rates.js";
import {
  classifyIssued,
  epoPhone,
  generateDphDp3,
  generateDphDp3Identified,
  generateDphKh1,
  generateDphShv,
  pragueToday,
  splitCzStreet,
  submitterFromTenant,
  supplierOrigin,
  type VatIssuedDoc,
  type VatReceivedDoc,
} from "../vat-returns.js";

// Prolog, then the caveat comment (no "--" inside, or the XML is malformed), then the root element.
const DISCLAIMED = /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!-- (?:(?!--)[^])+ -->\n<Pisemnost[ >]/;

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
  reverseCharge: false,
  reverseChargeCode: null,
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
    expect(xml).toContain('<Veta6 dan_zocelk="4320" odp_zocelk="2100" dano="0" dano_da="2220" dano_no="0" />');
    expect(xml).toContain('mesic="9"');
    expect(xml).toContain('d_poddp="10.10.2026"');
    expect(xml).toContain('dic="8001011234"');
    expect(xml).toMatch(DISCLAIMED);
  });
  it("self-assesses received reverse charge on ř. 10/11 and deducts it on ř. 43/44", () => {
    const xml = generateDphDp3({
      issued: [issued({})],
      received: [
        received({}),
        received({ number: "RC-1", reverseCharge: true, parts: [{ ratePercent: 21, base: 40000, vat: 8400 }], totalCzk: 48400 }),
        received({ number: "RC-2", reverseCharge: true, parts: [{ ratePercent: 12, base: 3000, vat: 360 }], totalCzk: 3360 }),
      ],
      submitter,
      period,
      today,
    });
    expect(xml).toContain(
      '<Veta1 obrat23="20000" dan23="4200" rez_pren23="40000" dan_rpren23="8400" rez_pren5="3000" dan_rpren5="360" />',
    );
    // Not in ř. 40/41: those are B.2/B.3 supplies with VAT on the invoice.
    expect(xml).toContain(
      '<Veta4 pln23="10000" odp_tuz23_nar="2100" nar_zdp23="40000" od_zdp23="8400" nar_zdp5="3000" od_zdp5="360" odp_sum_nar="10860" />',
    );
    // ř. 62 = 4200 + 8400 + 360, ř. 63 = ř. 46: the self-assessment nets out.
    expect(xml).toContain('<Veta6 dan_zocelk="12960" odp_zocelk="10860" dano="0" dano_da="2100" dano_no="0" />');
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
    expect(xml).toMatch(DISCLAIMED);
    expect(xml).toMatch(/<VetaA4 c_radku="1" dic_odb="12345678" c_evid_dd="2026-001" [^>]*zakl_dane1="20000" dan1="4200"/);
    expect(xml).toContain('<VetaA5 zakl_dane1="1000" dan1="210" zakl_dane2="0" dan2="0" />');
    expect(xml).toMatch(/<VetaB2 c_radku="1" dic_dod="87654321" c_evid_dd="FV-9"/);
    expect(xml).toContain('<VetaB3 zakl_dane1="100" dan1="21" zakl_dane2="0" dan2="0" />');
    expect(xml).toContain('<VetaC obrat23="21000" obrat5="0" pln23="10100" pln5="0" pln_rez_pren="50000" rez_pren23="0" rez_pren5="0" />');
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
  it("lists received reverse-charge documents in B.1, each with its code", () => {
    const rc = { reverseCharge: true as const };
    const { xml, warnings } = generateDphKh1({
      issued: [],
      received: [
        received({}),
        received({ ...rc, number: "RC-1", reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 40000, vat: 8400 }], totalCzk: 48400 }),
        // Below 10 000 CZK: B.1 has no threshold, and it must not land in B.3.
        received({ ...rc, number: "RC-2", supplierDic: "CZ11223344", reverseChargeCode: "14", parts: [{ ratePercent: 12, base: 3000, vat: 360 }], totalCzk: 3360 }),
      ],
      submitter,
      period,
      today,
    });
    expect(warnings).toEqual([]);
    expect(xml).toContain(
      '<VetaB1 c_radku="1" dic_dod="87654321" c_evid_dd="RC-1" duzp="15.09.2026" zakl_dane1="40000" dan1="8400" zakl_dane2="0" dan2="0" kod_pred_pl="4" />',
    );
    expect(xml).toContain(
      '<VetaB1 c_radku="2" dic_dod="11223344" c_evid_dd="RC-2" duzp="15.09.2026" zakl_dane1="0" dan1="0" zakl_dane2="3000" dan2="360" kod_pred_pl="14" />',
    );
    expect(xml.match(/<VetaB2 /g)).toHaveLength(1);
    expect(xml).not.toContain("<VetaB3");
    // B.1 sits between A.5 and B.2 in the EPO structure.
    expect(xml.indexOf("<VetaB1")).toBeLessThan(xml.indexOf("<VetaB2"));
    expect(xml).toContain('pln23="10000" pln5="0" pln_rez_pren="0" rez_pren23="40000" rez_pren5="3000" />');
  });
  it("warns about received reverse-charge documents EPO would refuse", () => {
    const rc = { reverseCharge: true as const, parts: [{ ratePercent: 21, base: 5000, vat: 1050 }], totalCzk: 6050 };
    const { xml, warnings } = generateDphKh1({
      issued: [],
      received: [
        received({ ...rc, number: "RC-nocode" }),
        received({ ...rc, number: "RC-nodic", supplierDic: null, reverseChargeCode: "4" }),
        received({ ...rc, number: "", reverseChargeCode: "4" }),
      ],
      submitter,
      period,
      today,
    });
    expect(warnings).toEqual([
      { code: "received_reverse_charge_code_missing", document: "RC-nocode" },
      { code: "received_reverse_charge_dic_missing", document: "RC-nodic" },
      { code: "received_reverse_charge_number_missing", document: "15.09.2026" },
    ]);
    // Only the row without a code is written; C counts only written rows.
    expect(xml.match(/<VetaB1 /g)).toHaveLength(1);
    expect(xml).toContain('<VetaB1 c_radku="1" dic_dod="87654321" c_evid_dd="RC-nocode" duzp="15.09.2026" zakl_dane1="5000" dan1="1050" zakl_dane2="0" dan2="0" />');
    expect(xml).toContain('rez_pren23="5000" rez_pren5="0" />');
  });
});

describe("generateDphShv", () => {
  it("groups EU supplies per customer VAT ID", () => {
    const eu = { customerDic: "DE123456789", customerCountry: "DE", parts: [{ ratePercent: 0, base: 3000, vat: 0 }] };
    const xml = generateDphShv({ issued: [issued(eu), issued({ ...eu, number: "x" }), issued({})], submitter, period, today })!;
    expect(xml).toContain('k_stat="DE" c_vat="123456789" k_pln_eu="3" pln_pocet="2" pln_hodnota="6000"');
    expect(xml.match(/<VetaR /g)).toHaveLength(1);
    expect(xml).toMatch(DISCLAIMED);
  });
  it("returns null with nothing to report", () => {
    expect(generateDphShv({ issued: [issued({})], submitter, period, today })).toBeNull();
  });
  it("leaves out e-mail and phone, which the DPHSHV VetaP does not have", () => {
    const eu = { customerDic: "DE123456789", customerCountry: "DE", parts: [{ ratePercent: 0, base: 3000, vat: 0 }] };
    const xml = generateDphShv({ issued: [issued(eu)], submitter: { ...submitter, telefon: "777123456" }, period, today })!;
    const vetaP = xml.match(/<VetaP [^>]*>/)![0];
    expect(vetaP).not.toMatch(/ email=| c_telef=/);
    // The other forms keep them.
    const dp3 = generateDphDp3({ issued: [issued(eu)], received: [], submitter: { ...submitter, telefon: "777123456" }, period, today });
    expect(dp3.match(/<VetaP [^>]*>/)![0]).toMatch(/ email="jan@example.cz" c_telef="777123456"/);
  });
});

describe("epoPhone", () => {
  it("fits c_telef (at most 14 characters): separators first, then the Czech prefix", () => {
    expect(epoPhone("+420 777 123 456")).toBe("+420777123456");
    expect(epoPhone("(+420) 777-123-456")).toBe("+420777123456");
    expect(epoPhone("+421 905 123 456")).toBe("+421905123456");
    expect(epoPhone("00420 777 123 456 78")).toBe("77712345678");
  });
  it("leaves out a number still too long rather than cutting it", () => {
    expect(epoPhone("+44 20 7946 0958 1234")).toBe("");
    expect(epoPhone(null)).toBe("");
  });
});

describe("parseCnbRates", () => {
  it("divides by the quoted amount", () => {
    const rates = parseCnbRates("01.10.2026 #190\nzemě|měna|množství|kód|kurz\nEMU|euro|1|EUR|24,330\nJaponsko|jen|100|JPY|15,512\n");
    expect(rates.get("EUR")).toBe(24.33);
    expect(rates.get("JPY")).toBeCloseTo(0.15512);
  });
});

describe("generateDphDp3Identified", () => {
  // Google Ireland ads (EU, 21 %), an EU e-book licence (12 %), a US tool (outside the EU),
  // a Czech supplier (nothing to report) and an Irish invoice entered without reverse charge.
  const google = received({ number: "IE-55", supplierDic: "IE6388047V", reverseCharge: true, parts: [{ ratePercent: 21, base: 1000, vat: 210 }], totalCzk: 1210 });
  const ebook = received({ number: "DE-7", supplierDic: null, supplierCountry: "DE", reverseCharge: true, parts: [{ ratePercent: 12, base: 500, vat: 60 }], totalCzk: 560 });
  const us = received({ number: "US-1", supplierDic: null, supplierCountry: "US", reverseCharge: true, parts: [{ ratePercent: 21, base: 300, vat: 63 }], totalCzk: 363 });
  const czech = received({});
  const unmarked = received({ number: "IE-56", supplierDic: "IE6388047V", parts: [], totalCzk: 0 });
  const euSale = issued({ number: "2026-010", customerDic: "DE123456789", customerCountry: "DE", parts: [{ ratePercent: 0, base: 5000, vat: 0 }], totalCzk: 5000 });
  const domesticSale = issued({ number: "2026-011", customerDic: null, parts: [{ ratePercent: 0, base: 7000, vat: 0 }], totalCzk: 7000 });

  const run = (r: VatReceivedDoc[], i: VatIssuedDoc[] = []) => generateDphDp3Identified({ issued: i, received: r, submitter, period, today });

  it("files as typ_platce I with the self-assessed EU services on ř. 5/6 and third-country ones on ř. 12/13", () => {
    const { xml, warnings } = run([google, ebook, us, czech], [euSale, domesticSale]);
    expect(xml).toMatch(DISCLAIMED);
    expect(xml).toContain('typ_platce="I"');
    expect(xml).not.toContain('typ_platce="P"');
    expect(xml).toContain('<Veta1 p_sl23_e="1000" dan_psl23_e="210" p_sl5_e="500" dan_psl5_e="60" p_sl23_z="300" dan_psl23_z="63" />');
    // Services to an EU business on ř. 21; the domestic non-VAT sale is not in the return.
    expect(xml).toContain('<Veta2 pln_sluzby="5000" />');
    expect(xml).not.toContain("7000");
    // The Czech supplier's invoice is neither tax nor a deduction.
    expect(xml).not.toContain("obrat23");
    expect(xml).not.toContain("10000");
    expect(warnings).toEqual([]);
  });

  it("claims no deduction: no Veta4 and the whole tax is due", () => {
    const { xml } = run([google, ebook, us]);
    expect(xml).not.toContain("<Veta4");
    expect(xml).not.toContain("odp_tuz");
    expect(xml).not.toContain("nar_zdp");
    expect(xml).toContain('<Veta6 dan_zocelk="333" dano="0" dano_da="333" dano_no="0" />');
  });

  it("returns nothing for a month without a foreign purchase or EU sale", () => {
    expect(run([czech], [domesticSale]).xml).toBeNull();
  });

  it("files an EU-sales-only month with ř. 21 and no tax", () => {
    const { xml } = run([], [euSale]);
    expect(xml).not.toContain("<Veta1");
    expect(xml).toContain('<Veta6 dan_zocelk="0" dano="0" dano_da="0" dano_no="0" />');
  });

  it("warns about a foreign purchase not marked as reverse charge with a rate", () => {
    const { xml, warnings } = run([google, unmarked]);
    expect(warnings).toEqual([{ code: "foreign_purchase_unmarked", document: "IE-56" }]);
    expect(xml).toContain('p_sl23_e="1000"');
  });
});

describe("supplierOrigin", () => {
  it("prefers the DIČ prefix over the contact country", () => {
    expect(supplierOrigin({ supplierDic: "IE6388047V", supplierCountry: "CZ" })).toBe("eu");
    expect(supplierOrigin({ supplierDic: "CZ12345678", supplierCountry: "IE" })).toBe("domestic");
    expect(supplierOrigin({ supplierDic: null, supplierCountry: "us" })).toBe("third_country");
    expect(supplierOrigin({ supplierDic: null, supplierCountry: null })).toBe("domestic");
  });
});

// Every amount below rounds differently up and mathematically, so each
// assertion tells the two rules apart (e.g. 32.13 is 33 up and 32 mathematically).
describe("rounding of the Czech VAT filings", () => {
  it("DPHDP3: tax lines up (§ 146 DŘ), bases and deductions mathematically, ř. 62/64 from the rounded lines", () => {
    const xml = generateDphDp3({
      issued: [
        issued({ parts: [{ ratePercent: 21, base: 1000.4, vat: 210.08 }], totalCzk: 1210.48 }),
        issued({ number: "2026-002", parts: [{ ratePercent: 12, base: 100.3, vat: 12.04 }], totalCzk: 112.34 }),
      ],
      received: [
        received({ parts: [{ ratePercent: 21, base: 500.4, vat: 105.08 }], totalCzk: 605.48 }),
        received({ number: "RC-1", reverseCharge: true, parts: [{ ratePercent: 21, base: 152.49, vat: 32.02 }], totalCzk: 152.49 }),
        received({ number: "RC-2", reverseCharge: true, parts: [{ ratePercent: 12, base: 10.4, vat: 1.25 }], totalCzk: 10.4 }),
      ],
      submitter,
      period,
      today,
    });
    expect(xml).toContain(
      '<Veta1 obrat23="1000" dan23="211" obrat5="100" dan5="13" rez_pren23="152" dan_rpren23="33" rez_pren5="10" dan_rpren5="2" />',
    );
    // The deduction of the same reverse-charge tax stays mathematical: 32, not 33.
    expect(xml).toContain(
      '<Veta4 pln23="500" odp_tuz23_nar="105" nar_zdp23="152" od_zdp23="32" nar_zdp5="10" od_zdp5="1" odp_sum_nar="138" />',
    );
    // ř. 62 = 211 + 13 + 33 + 2, ř. 63 = 105 + 32 + 1, ř. 64 = 259 − 138.
    expect(xml).toContain('<Veta6 dan_zocelk="259" odp_zocelk="138" dano="0" dano_da="121" dano_no="0" />');
  });

  it("DPHDP3: a tax line below one crown is still filed, as 1", () => {
    const xml = generateDphDp3({ issued: [issued({ parts: [{ ratePercent: 21, base: 1.4, vat: 0.29 }], totalCzk: 1.69 })], received: [], submitter, period, today });
    expect(xml).toContain('<Veta1 obrat23="1" dan23="1" />');
    expect(xml).toContain('dan_zocelk="1"');
  });

  it("DPHDP3: credit notes round toward +∞ for tax and away from zero for the base", () => {
    const xml = generateDphDp3({
      issued: [issued({ number: "D-1", parts: [{ ratePercent: 21, base: -500.5, vat: -105.7 }], totalCzk: -606.2 })],
      received: [],
      submitter,
      period,
      today,
    });
    expect(xml).toContain('<Veta1 obrat23="-501" dan23="-105" />');
    expect(xml).toContain('<Veta6 dan_zocelk="-105" odp_zocelk="0" dano="0" dano_da="0" dano_no="105" />');
  });

  it("DPHDP3: float noise in a sum does not add a crown", () => {
    // 0.11 + 3.99 + 0.9 is 5.000000000000001 in floating point.
    const docs = [0.11, 3.99, 0.9].map((vat, i) => issued({ number: `n${i}`, parts: [{ ratePercent: 21, base: 10, vat }], totalCzk: 10 + vat }));
    const xml = generateDphDp3({ issued: docs, received: [], submitter, period, today });
    expect(xml).toContain('dan23="5"');
  });

  it("identified person: the tax rounds up, so 152.99 Kč of Google Ads owes 33 Kč, not 32", () => {
    const ads = received({ number: "IE-10", supplierDic: "IE6388047V", reverseCharge: true, parts: [{ ratePercent: 21, base: 152.99, vat: 32.1279 }], totalCzk: 152.99 });
    const tool = received({ number: "US-2", supplierDic: null, supplierCountry: "US", reverseCharge: true, parts: [{ ratePercent: 21, base: 300.4, vat: 63.08 }], totalCzk: 300.4 });
    const { xml } = generateDphDp3Identified({ issued: [], received: [ads, tool], submitter, period, today });
    expect(xml).toContain('<Veta1 p_sl23_e="153" dan_psl23_e="33" p_sl23_z="300" dan_psl23_z="64" />');
    expect(xml).toContain('<Veta6 dan_zocelk="97" dano="0" dano_da="97" dano_no="0" />');
  });

  it("identified person: 151.84 Kč at 21 % (31.8864 Kč) is 32 Kč", () => {
    const ads = received({ number: "IE-11", supplierDic: "IE6388047V", reverseCharge: true, parts: [{ ratePercent: 21, base: 151.84, vat: 31.8864 }], totalCzk: 151.84 });
    const { xml } = generateDphDp3Identified({ issued: [], received: [ads], submitter, period, today });
    expect(xml).toContain('<Veta1 p_sl23_e="152" dan_psl23_e="32" />');
  });

  it("rounds whole crowns from the exact amount, never from one already taken to haléře", () => {
    // Via haléře the tax would be 30.00 → 30 and the base 152.50 → 153.
    const ads = received({ number: "IE-12", supplierDic: "IE6388047V", reverseCharge: true, parts: [{ ratePercent: 21, base: 152.496, vat: 30.004 }], totalCzk: 152.496 });
    const { xml } = generateDphDp3Identified({ issued: [], received: [ads], submitter, period, today });
    expect(xml).toContain('<Veta1 p_sl23_e="152" dan_psl23_e="31" />');
  });

  it("DPHKH1 keeps the haléře of the documents and part C sums them", () => {
    const { xml } = generateDphKh1({
      issued: [
        issued({ parts: [{ ratePercent: 21, base: 10000.4, vat: 2100.08 }], totalCzk: 12100.48 }),
        issued({ number: "s1", parts: [{ ratePercent: 21, base: 100.25, vat: 21.05 }], totalCzk: 121.3 }),
        issued({ number: "s2", parts: [{ ratePercent: 21, base: 100.3, vat: 21.06 }], totalCzk: 121.36 }),
      ],
      received: [received({ number: "RC-3", reverseCharge: true, reverseChargeCode: "4", parts: [{ ratePercent: 21, base: 152.49, vat: 32.02 }], totalCzk: 152.49 })],
      submitter,
      period,
      today,
    });
    expect(xml).toMatch(/<VetaA4 [^>]*zakl_dane1="10000.4" dan1="2100.08" zakl_dane2="0" dan2="0"/);
    expect(xml).toContain('<VetaA5 zakl_dane1="200.55" dan1="42.11" zakl_dane2="0" dan2="0" />');
    expect(xml).toMatch(/<VetaB1 [^>]*zakl_dane1="152.49" dan1="32.02"/);
    expect(xml).toContain('<VetaC obrat23="10200.95" obrat5="0" pln23="0" pln5="0" pln_rez_pren="0" rez_pren23="152.49" rez_pren5="0" />');
  });

  it("DPHKH1 itemizes a document of 10 000.40 Kč incl. VAT: it is above the threshold", () => {
    const { xml } = generateDphKh1({
      issued: [issued({ parts: [{ ratePercent: 21, base: 8264.79, vat: 1735.61 }], totalCzk: 10000.4 })],
      received: [],
      submitter,
      period,
      today,
    });
    expect(xml).toContain("<VetaA4 ");
    expect(xml).not.toContain("<VetaA5 ");
  });

  it("DPHSHV rounds each row's total up, credit notes counted negative", () => {
    const de = { customerDic: "DE123456789", customerCountry: "DE" };
    const fr = { customerDic: "FR12345678901", customerCountry: "FR" };
    const xml = generateDphShv({
      issued: [
        issued({ ...de, parts: [{ ratePercent: 0, base: 1000.2, vat: 0 }] }),
        issued({ ...de, number: "x", parts: [{ ratePercent: 0, base: 500.1, vat: 0 }] }),
        issued({ ...fr, number: "y", parts: [{ ratePercent: 0, base: 1000.2, vat: 0 }] }),
        issued({ ...fr, number: "dobropis", parts: [{ ratePercent: 0, base: -200.9, vat: 0 }] }),
      ],
      submitter,
      period,
      today,
    })!;
    expect(xml).toContain('k_stat="DE" c_vat="123456789" k_pln_eu="3" pln_pocet="2" pln_hodnota="1501"');
    expect(xml).toContain('k_stat="FR" c_vat="12345678901" k_pln_eu="3" pln_pocet="2" pln_hodnota="800"');
  });
});

// EPO structures as of 2026-11-27: DPHDP3 03.01.04, DPHKH1 03.01.15,
// DPHSHV 02.01.05 (adisspr.mfcr.cz popis_struktury_seznam and the *_epo2.xsd).
describe("EPO structures of 2026", () => {
  const tenant = {
    legalName: "Jan Novák",
    dic: "CZ8001011234",
    addressStreet: "Masarykova 12/3a",
    addressCity: "Brno",
    addressPostalCode: "602 00",
    addressCountry: "CZ",
    email: null,
    phone: null,
  };
  // A 152 Kč ad bought from an EU supplier: 21 % is 31.92 Kč, which rounds up to 32.
  const ad = received({ number: "AD-1", supplierDic: "IE6388047V", reverseCharge: true, parts: [{ ratePercent: 21, base: 152, vat: 31.92 }], totalCzk: 152 });

  it("identified person: 152 Kč of EU ads is ř. 5/6 152 and 32, Veta6 32, verzePis 03.01", () => {
    const { xml } = generateDphDp3Identified({ issued: [], received: [ad], submitter, period, today });
    expect(xml).toContain('<DPHDP3 verzePis="03.01">');
    expect(xml).toContain('<Veta1 p_sl23_e="152" dan_psl23_e="32" />');
    // As in the file EPO saves for an identified person: no ř. 63.
    expect(xml).toContain('<Veta6 dan_zocelk="32" dano="0" dano_da="32" dano_no="0" />');
    expect(xml).not.toContain("odp_zocelk");
  });

  it("payer: an EU service goes to ř. 5/6 and a third-country one to ř. 12/13, not to ř. 10/11", () => {
    const us = received({ number: "US-1", supplierDic: null, supplierCountry: "US", reverseCharge: true, parts: [{ ratePercent: 21, base: 300, vat: 63 }], totalCzk: 300 });
    const domestic = received({ number: "RC-1", reverseCharge: true, parts: [{ ratePercent: 21, base: 1000, vat: 210 }], totalCzk: 1000 });
    const xml = generateDphDp3({ issued: [], received: [ad, us, domestic], submitter, period, today });
    expect(xml).toContain('<DPHDP3 verzePis="03.01">');
    expect(xml).toContain(
      '<Veta1 p_sl23_e="152" dan_psl23_e="32" rez_pren23="1000" dan_rpren23="210" p_sl23_z="300" dan_psl23_z="63" />',
    );
    // ř. 43 covers ř. 3 to 13, so all three are deducted there: 152 + 300 + 1000 and 31.92 + 63 + 210 = 304.92.
    expect(xml).toContain('<Veta4 nar_zdp23="1452" od_zdp23="305" odp_sum_nar="305" />');
    expect(xml).toContain('<Veta6 dan_zocelk="305" odp_zocelk="305" dano="0" dano_da="0" dano_no="0" />');
  });

  it("KH: reverse-charge purchases from abroad go to A.2 and celk_zd_a2, not to B.1", () => {
    const us = received({ number: "US-1", supplierDic: null, supplierCountry: "US", reverseCharge: true, parts: [{ ratePercent: 21, base: 300, vat: 63 }], totalCzk: 300 });
    const { xml, warnings } = generateDphKh1({ issued: [], received: [ad, us], submitter, period, today });
    expect(xml).toContain(
      '<VetaA2 c_radku="1" k_stat="IE" vatid_dod="6388047V" c_evid_dd="AD-1" dppd="15.09.2026" zakl_dane1="152" dan1="31.92" zakl_dane2="0" dan2="0" />',
    );
    // Outside the EU there is no VAT ID, so k_stat and vatid_dod stay empty.
    expect(xml).toContain('<VetaA2 c_radku="2" c_evid_dd="US-1" dppd="15.09.2026" zakl_dane1="300" dan1="63" zakl_dane2="0" dan2="0" />');
    expect(xml).not.toContain("<VetaB1");
    expect(xml).toContain('<VetaC celk_zd_a2="452" obrat23="0"');
    expect(xml).toContain('rez_pren23="0" rez_pren5="0" />');
    expect(warnings).toEqual([]);
  });

  it("KH: a Swiss VAT number is not an EU one, so its A.2 row has no k_stat", () => {
    const ch = received({ number: "CH-1", supplierDic: "CHE123456789", reverseCharge: true, parts: [{ ratePercent: 21, base: 500, vat: 105 }], totalCzk: 500 });
    const { xml } = generateDphKh1({ issued: [], received: [ch], submitter, period, today });
    expect(xml).toContain('<VetaA2 c_radku="1" c_evid_dd="CH-1" dppd="15.09.2026" zakl_dane1="500" dan1="105" zakl_dane2="0" dan2="0" />');
    expect(xml).not.toContain("k_stat=");
  });

  it("writes c_ufo and c_pracufo into every VetaP when they are set", () => {
    const s = submitterFromTenant({ ...tenant, taxOffice: 461, taxWorkplace: 3004 });
    const dp3 = generateDphDp3({ issued: [issued({})], received: [], submitter: s, period, today });
    const kh = generateDphKh1({ issued: [issued({})], received: [], submitter: s, period, today }).xml;
    const shv = generateDphShv({ issued: [issued({ customerDic: "DE123456789", customerCountry: "DE" })], submitter: s, period, today })!;
    for (const xml of [dp3, kh, shv]) expect(xml).toContain('<VetaP c_ufo="461" c_pracufo="3004" dic="8001011234"');
    // Unset, they stay out and EPO asks for the office, as before.
    expect(generateDphDp3({ issued: [issued({})], received: [], submitter, period, today })).not.toContain("c_ufo");
    // A pracoviště without its office is dropped: it means nothing on its own.
    expect(submitterFromTenant({ ...tenant, taxWorkplace: 3004 }).cPracufo).toBeNull();
  });

  it("names a legal person in zkrobchjm, the attribute the XSDs have", () => {
    const s = submitterFromTenant({ ...tenant, legalName: "Acme s.r.o." });
    const xml = generateDphDp3({ issued: [issued({})], received: [], submitter: s, period, today });
    expect(xml).toContain('typ_ds="P" zkrobchjm="Acme s.r.o."');
    expect(xml).not.toContain("nazev_prav_osoby");
  });

  it("splits a village address the way EPO wants it", () => {
    expect(splitCzStreet("Sedlec 3")).toEqual({ ulice: "Sedlec", cPop: "3", cOrient: "" });
    expect(splitCzStreet("Sedlec č. p. 3")).toEqual({ ulice: "Sedlec", cPop: "3", cOrient: "" });
    expect(splitCzStreet("čp. 3")).toEqual({ ulice: "", cPop: "3", cOrient: "" });
    expect(splitCzStreet("3")).toEqual({ ulice: "", cPop: "3", cOrient: "" });
    expect(splitCzStreet("Masarykova 12/3a")).toEqual({ ulice: "Masarykova", cPop: "12", cOrient: "3a" });
    // c_pop is digits only: an evidenční číslo is left whole for EPO.
    expect(splitCzStreet("Sedlec ev. č. 12")).toEqual({ ulice: "Sedlec ev. č. 12", cPop: "", cOrient: "" });
    const s = submitterFromTenant({ ...tenant, addressStreet: "Sedlec 3", addressCity: "Sedlec", addressPostalCode: "373 01" });
    const xml = generateDphDp3({ issued: [issued({})], received: [], submitter: s, period, today });
    expect(xml).toContain('naz_obce="Sedlec" ulice="Sedlec" c_pop="3" psc="37301"');
    expect(xml).not.toContain("c_orient");
  });

  it("uses the residence address for a natural person when it is filled", () => {
    const withHome = { ...tenant, residenceStreet: "Sedlec 3", residenceCity: "Sedlec", residencePostalCode: "373 01" };
    expect(submitterFromTenant(withHome)).toMatchObject({ obec: "Sedlec", ulice: "Sedlec", cPop: "3", cOrient: "", psc: "373 01" });
    // A company files from its sídlo, whatever is in the residence fields.
    expect(submitterFromTenant({ ...withHome, legalName: "Acme s.r.o." })).toMatchObject({ obec: "Brno", ulice: "Masarykova", psc: "602 00" });
    // Empty residence fields keep the business address.
    expect(submitterFromTenant({ ...tenant, residenceStreet: " ", residenceCity: null })).toMatchObject({ obec: "Brno", cPop: "12" });
  });

  it("prefers the filing contact over the one on invoices", () => {
    const s = submitterFromTenant({ ...tenant, email: "faktury@example.cz", phone: "111", filingEmail: "urad@example.cz", filingPhone: "+420 222" });
    expect(s).toMatchObject({ email: "urad@example.cz", telefon: "+420 222" });
    expect(submitterFromTenant({ ...tenant, email: "faktury@example.cz", phone: null, filingEmail: " ", filingPhone: "+420 222" })).toMatchObject({ email: "faktury@example.cz", telefon: "+420 222" });
  });
});

describe("pragueToday", () => {
  it("gives the Czech day, not the UTC one", () => {
    // 23:30 UTC on 27 Nov is already 28 Nov in Prague (CET).
    expect(pragueToday(new Date("2026-11-27T23:30:00Z"))).toBe("28.11.2026");
    // Summer time: 22:30 UTC on 30 Jun is 1 Jul in Prague (CEST).
    expect(pragueToday(new Date("2026-06-30T22:30:00Z"))).toBe("01.07.2026");
  });
});
