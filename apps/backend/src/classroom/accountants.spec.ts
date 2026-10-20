import { describe, expect, it } from "vitest";
import { effectivePermissions } from "../tenancy/permissions";
import { accountantModes, accountantPermissions } from "./accountants";

describe("classroom accountants", () => {
  it("lets a reviewing accountant only read", () => {
    const p = effectivePermissions("accountant", accountantPermissions("review"));
    expect(Object.values(p).every((l) => l === "read")).toBe(true);
  });

  it("lets a bookkeeper book costs and payments but not touch invoices", () => {
    expect(effectivePermissions("accountant", accountantPermissions("bookkeeper"))).toEqual({
      invoices: "read",
      contacts: "read",
      expenses: "write",
      bank: "write",
      reports: "write",
    });
  });

  it("gives full mode the accountant role's defaults", () => {
    expect(accountantPermissions("full")).toBeNull();
    expect(effectivePermissions("accountant", accountantPermissions("full")).invoices).toBe("write");
  });

  it("offers only review in basic classes", () => {
    expect(accountantModes("basic")).toEqual(["review"]);
    expect(accountantModes("standard")).toContain("bookkeeper");
  });
});
