import { describe, expect, it } from "vitest";
import { fillTemplate } from "./email-prefs";
import { templateValues, templateVarsSchema } from "./template-vars";

const tenant = {
  companyName: "Demo s.r.o.",
  ico: "12345678",
  dic: null,
  email: "info@demo.cz",
  phone: null,
  website: null,
  addressStreet: "Dlouhá 1",
  addressCity: "Praha",
  addressPostalCode: "110 00",
  bankAccountNumber: "123456789",
  bankAccountBankCode: "0100",
  bankAccountIban: null,
  templateVars: [{ key: "vop", value: "https://demo.cz/vop", label: "VOP" }, { key: "number", value: "hack" }],
};

describe("template vars", () => {
  it("rejects built-in names, bad keys and duplicates", () => {
    expect(templateVarsSchema.safeParse([{ key: "number", value: "x" }]).success).toBe(false);
    expect(templateVarsSchema.safeParse([{ key: "Bad-Key", value: "x" }]).success).toBe(false);
    expect(templateVarsSchema.safeParse([{ key: "a", value: "1" }, { key: "a", value: "2" }]).success).toBe(false);
    expect(templateVarsSchema.parse([{ key: "vop", value: "x", label: "" }])).toEqual([{ key: "vop", value: "x", label: null }]);
  });

  it("fills own and built-in values, built-ins winning", () => {
    const invoice = {
      invoiceNumber: "2026-0001",
      variableSymbol: "20260001",
      issueDate: new Date("2026-10-01T10:00:00Z"),
      dueDate: new Date("2026-10-15T10:00:00Z"),
      publicToken: "tok",
    };
    const values = templateValues(tenant, invoice, { legalName: "Novák", ico: null }, new Date("2026-10-03T10:00:00Z"));
    expect(fillTemplate("{number} / VS {vs} / {vop} / {bank_account} / {address} / {year} / {unknown}", values)).toBe(
      "2026-0001 / VS 20260001 / https://demo.cz/vop / 123456789/0100 / Dlouhá 1, 110 00 Praha / 2026 / {unknown}",
    );
  });

  it("puts the readable short links in {link} and {portal_link}", () => {
    const invoice = { invoiceNumber: "2026-0001", variableSymbol: null, issueDate: null, dueDate: null, publicToken: "0f8fad5b-d9cb-469f-a165-70867728950e", publicKey: "aZ09bY18cX27" };
    const contact = { legalName: "Novák", ico: null, portalToken: "33333333-3333-4333-8333-333333333333", portalKey: "Qw12Er34Ty56" };
    const values = templateValues({ ...tenant, invoiceFormPrefs: { publicLinkPrefix: "company_number" } }, invoice, contact);
    expect(values.link.endsWith("/i/demo-s-r-o-2026-0001-aZ09bY18cX27")).toBe(true);
    expect(values.portal_link.endsWith("/c/novak-Qw12Er34Ty56")).toBe(true);
  });
});
