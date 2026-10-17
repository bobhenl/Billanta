import { describe, expect, it } from "vitest";
import { reverseChargeNoteKind } from "../invoices/invoice-pdf.service";
import { cleanAdvances, vatFields } from "./tenants.service";

describe("vatFields", () => {
  it("writes vat_status and the legacy flag together", () => {
    expect(vatFields({ vat_status: "identified" }, "payer")).toEqual({ vatStatus: "identified", dicVatPayer: false });
    expect(vatFields({ vat_status: "payer", dic_vat_payer: false }, "non_payer")).toEqual({ vatStatus: "payer", dicVatPayer: true });
  });

  it("maps the legacy boolean, keeping an identified person identified", () => {
    expect(vatFields({ dic_vat_payer: true }, "identified")).toEqual({ vatStatus: "payer", dicVatPayer: true });
    expect(vatFields({ dic_vat_payer: false }, "identified")).toEqual({ vatStatus: "identified", dicVatPayer: false });
    expect(vatFields({ dic_vat_payer: false }, "payer")).toEqual({ vatStatus: "non_payer", dicVatPayer: false });
    expect(vatFields({}, "payer")).toEqual({});
  });
});

describe("cleanAdvances", () => {
  it("keeps positive amounts, rounded to cents", () => {
    expect(cleanAdvances({ social: 5720.004, health: 0, flat_tax: null })).toEqual({ social: 5720 });
  });
});

describe("reverseChargeNoteKind", () => {
  const eu = { ico: null, dic: "DE123456789", isPerson: false, addressCountry: "DE" };
  const invoice = { documentType: "invoice" as const, reverseCharge: false };
  const tenant = (vatStatus: "payer" | "identified" | "non_payer") => ({ vatStatus, addressCountry: "CZ" });

  it("prints 'daň odvede zákazník' for an identified person's service to an EU business", () => {
    expect(reverseChargeNoteKind(invoice, tenant("identified"), eu)).toBe("eu");
    expect(reverseChargeNoteKind({ ...invoice, documentType: "proforma" }, tenant("identified"), eu)).toBeNull();
  });

  it("no note to a UK business, a private person or from a non-payer", () => {
    expect(reverseChargeNoteKind(invoice, tenant("identified"), { ...eu, dic: "GB123456789", addressCountry: "GB" })).toBeNull();
    expect(reverseChargeNoteKind(invoice, tenant("identified"), { ...eu, isPerson: true })).toBeNull();
    expect(reverseChargeNoteKind(invoice, tenant("non_payer"), eu)).toBeNull();
  });

  it("payer: the EU wording with reverse charge to an EU business, the §92a note at home", () => {
    expect(reverseChargeNoteKind(invoice, tenant("payer"), eu)).toBeNull();
    expect(reverseChargeNoteKind({ ...invoice, reverseCharge: true }, tenant("payer"), eu)).toBe("eu");
    expect(reverseChargeNoteKind({ ...invoice, reverseCharge: true }, tenant("payer"), { ...eu, dic: "CZ12345679", addressCountry: "CZ" })).toBe("domestic");
  });
});
