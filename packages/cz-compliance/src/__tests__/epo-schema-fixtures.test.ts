import { describe, expect, it } from "vitest";
import { DPFDP_FORMS } from "../annual-filings.js";
import { EPO_SCHEMA_FORMS, epoSchemaSamples } from "../epo-schema-fixtures.js";

describe("epoSchemaSamples", () => {
  const samples = epoSchemaSamples();

  it("has samples for every watched form, so none is blocked or passed on no evidence", () => {
    for (const { form } of EPO_SCHEMA_FORMS) expect(samples.filter((s) => s.form === form).length, form).toBeGreaterThan(0);
    expect(EPO_SCHEMA_FORMS.map((f) => f.form)).toEqual(["dphdp3", "dphkh1", "dphshv", ...DPFDP_FORMS.map((f) => f.form.toLowerCase())]);
  });

  it("covers every row type the VAT generators write", () => {
    const kh = samples.find((s) => s.name === "DPHKH1 měsíc")!.xml;
    for (const veta of ["VetaA1", "VetaA2", "VetaA4", "VetaA5", "VetaB1", "VetaB2", "VetaB3", "VetaC"]) expect(kh).toContain(`<${veta} `);
    expect(samples.map((s) => s.name)).toContain("DPHDP3 identifikovaná osoba");
    expect(samples.find((s) => s.form === "dphshv")!.xml).toContain("<VetaR ");
  });

  it("puts each sample under the form its root element names", () => {
    for (const s of samples) expect(s.xml, s.name).toMatch(new RegExp(`<Pisemnost[^>]*>\\s*<${s.form.toUpperCase()} `));
  });

  it("points at the official EPO schema of each form", () => {
    expect(EPO_SCHEMA_FORMS[0]!.xsdUrl).toBe("https://adisspr.mfcr.cz/adis/jepo/schema/dphdp3_epo2.xsd");
  });
});
