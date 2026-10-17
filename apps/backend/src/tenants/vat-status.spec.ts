import { describe, expect, it } from "vitest";
import { reverseChargeNoteKind } from "../invoices/invoice-pdf.service";
import { taxAdvancesSchema } from "./dto/update-tenant.dto";
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
  it("rounds to cents, keeps 0, drops null and empty periods, sorts oldest first", () => {
    expect(
      cleanAdvances([
        { from: "2026-07", social: 5005.004, flat_tax: null },
        { from: "2026-03" },
        { from: "2026-01", social: 5720, health: 0 },
      ]),
    ).toEqual([
      { from: "2026-01", social: 5720, health: 0 },
      { from: "2026-07", social: 5005 },
    ]);
  });
});

describe("taxAdvancesSchema", () => {
  const ok = (v: unknown) => taxAdvancesSchema.safeParse(v).success;

  it("accepts a list of periods", () => {
    expect(ok([{ from: "2026-01", social: 5720, health: 3306, flat_tax: null }, { from: "2026-07", social: 5005 }])).toBe(true);
    expect(ok([])).toBe(true);
  });

  it("from must be a real YYYY-MM month in a sane year", () => {
    expect(ok([{ from: "2026-13", social: 1 }])).toBe(false);
    expect(ok([{ from: "2026-1", social: 1 }])).toBe(false);
    expect(ok([{ from: "1999-12", social: 1 }])).toBe(false);
    expect(ok([{ social: 1 }])).toBe(false);
  });

  it("amounts are 0 to 10 million, no unknown keys", () => {
    expect(ok([{ from: "2026-01", social: -1 }])).toBe(false);
    expect(ok([{ from: "2026-01", health: 10_000_001 }])).toBe(false);
    expect(ok([{ from: "2026-01", payroll: 100 }])).toBe(false);
  });

  it("rejects two periods from the same month", () => {
    expect(ok([{ from: "2026-01", social: 1 }, { from: "2026-01", health: 2 }])).toBe(false);
  });

  it("the old single object is no longer accepted", () => {
    expect(ok({ social: 5720 })).toBe(false);
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
