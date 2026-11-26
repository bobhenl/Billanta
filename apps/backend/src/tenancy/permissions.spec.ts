import { describe, expect, it } from "vitest";
import {
  ACTION_KEYS,
  PERMISSION_AREAS,
  assertMayDo,
  effectiveActions,
  effectivePermissions,
  meetsRequirement,
  requirementFor,
  sectionsForTenantPatch,
  TENANT_FIELD_SECTIONS,
  type PermissionAction,
} from "./permissions";
import { updateTenantSchema } from "../tenants/dto/update-tenant.dto";

const allowed = (role: string, perms: unknown, method: string, path: string, body?: unknown) => {
  const req = requirementFor(method, path, body);
  if (req === "admin") return false;
  return req ? meetsRequirement(role, perms, req) : null;
};

describe("effectivePermissions", () => {
  it("keeps old five-area values meaning the same", () => {
    const old = { invoices: "write", contacts: "write", expenses: "none", bank: "read", reports: "none" };
    const p = effectivePermissions("accountant", old);
    expect(p).toMatchObject(old);
    // Projects and recurring used to be part of invoices.
    expect(p.projects).toBe("write");
    expect(p.recurring).toBe("write");
    expect(p.settings).toBe("read");
    const a = effectiveActions("accountant", old);
    expect(a["invoices.issue"]).toBe(true);
    expect(a["invoices.send"]).toBe(true);
    expect(a["expenses.create"]).toBe(false);
    expect(a["bank.match"]).toBe(false);
    expect(a["reports.export"]).toBe(false);
  });

  it("lets projects and recurring follow an overridden invoices level unless set themselves", () => {
    expect(effectivePermissions("accountant", { invoices: "none" })).toMatchObject({ projects: "none", recurring: "none" });
    expect(effectivePermissions("viewer", { invoices: "write" })).toMatchObject({ projects: "write", recurring: "write" });
    expect(effectivePermissions("accountant", { invoices: "none", projects: "write" })).toMatchObject({ projects: "write", recurring: "none" });
  });

  it("gives owners, admins and API keys everything whatever is stored", () => {
    for (const role of ["owner", "admin", "service"]) {
      expect(Object.values(effectivePermissions(role, { invoices: "none" })).every((l) => l === "write")).toBe(true);
      expect(Object.values(effectiveActions(role, { actions: { "invoices.issue": false } })).every(Boolean)).toBe(true);
    }
  });

  it("falls back to role defaults for malformed or unknown keys", () => {
    expect(effectivePermissions("accountant", { invoices: "bogus" }).invoices).toBe("write");
    expect(effectiveActions("accountant", { actions: { "invoices.fly": true, "invoices.issue": false } })["invoices.issue"]).toBe(true);
    expect(effectivePermissions("nobody")).toEqual(Object.fromEntries(PERMISSION_AREAS.map((a) => [a, "none"])));
    expect(Object.values(effectiveActions("nobody", { actions: { "invoices.issue": true } })).some(Boolean)).toBe(false);
  });
});

describe("effectiveActions", () => {
  it("defaults the actions on, except the ones only admins had before", () => {
    const a = effectiveActions("accountant");
    expect(a["invoices.issue"]).toBe(true);
    expect(a["expenses.approve"]).toBe(true);
    expect(a["bank.connections"]).toBe(false);
    expect(ACTION_KEYS.filter((k) => k.startsWith("settings.")).every((k) => !a[k])).toBe(true);
  });

  it("applies stored flags", () => {
    const a = effectiveActions("accountant", { actions: { "invoices.issue": false, "bank.connections": true, "settings.numbering": true }, settings: "write" });
    expect(a["invoices.issue"]).toBe(false);
    expect(a["invoices.create"]).toBe(true);
    expect(a["bank.connections"]).toBe(true);
    expect(a["settings.numbering"]).toBe(true);
    expect(a["settings.company"]).toBe(false);
  });

  it("switches an action off when its area level is too low, whatever the flag", () => {
    const a = effectiveActions("accountant", { invoices: "read", reports: "none", settings: "read", actions: { "invoices.issue": true, "reports.export": true, "settings.company": true } });
    expect(a["invoices.issue"]).toBe(false);
    expect(a["reports.export"]).toBe(false);
    expect(a["settings.company"]).toBe(false);
    // Exporting needs only read.
    expect(effectiveActions("viewer")["reports.export"]).toBe(true);
    expect(effectiveActions("viewer")["invoices.create"]).toBe(false);
  });

  it("assertMayDo refuses with a stable code", () => {
    expect(() => assertMayDo({ role: "accountant", permissions: { actions: { "invoices.send": false } } }, "invoices.send")).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ error: "permission_denied", permission: "invoices.send" }) }),
    );
    expect(() => assertMayDo({ role: "accountant" }, "invoices.send")).not.toThrow();
    expect(() => assertMayDo(undefined, "invoices.send")).toThrow();
  });
});

describe("requirementFor", () => {
  const cases: [string, string, PermissionAction[]][] = [
    ["POST", "v1/invoices", ["invoices.create"]],
    ["PATCH", "v1/invoices/1", ["invoices.create"]],
    ["POST", "v1/invoices/1/mark-paid", ["invoices.create"]],
    ["DELETE", "v1/invoices/1/attachments/2", ["invoices.create"]],
    ["POST", "v1/invoice-templates/1/bulk", ["invoices.create"]],
    ["POST", "v1/invoices/1/issue", ["invoices.issue"]],
    ["POST", "v1/invoices/1/refresh-parties", ["invoices.issue"]],
    ["POST", "v1/invoices/1/send", ["invoices.send"]],
    ["POST", "v1/invoices/1/remind", ["invoices.send"]],
    ["POST", "v1/invoices/1/einvoice", ["invoices.send"]],
    ["POST", "v1/invoices/1/public-link/rotate", ["invoices.send"]],
    ["PATCH", "v1/invoices/1/public-link", ["invoices.send"]],
    ["POST", "v1/invoices/1/buyer-details-request", ["invoices.send"]],
    ["POST", "v1/invoices/1/cancel", ["invoices.cancel"]],
    ["DELETE", "v1/invoices/1", ["invoices.cancel"]],
    ["POST", "v1/expenses", ["expenses.create"]],
    ["DELETE", "v1/expenses/1", ["expenses.delete"]],
    ["POST", "v1/expenses/einvoices/incoming/1/accept", ["expenses.approve"]],
    ["POST", "v1/expenses/einvoices/incoming/1/reject", ["expenses.approve"]],
    ["POST", "v1/bank-reconciliation/import", ["bank.match"]],
    ["POST", "v1/bank-reconciliation/transactions/1/match", ["bank.match"]],
    ["POST", "v1/bank-reconciliation/connections/1/sync", ["bank.match"]],
    ["POST", "v1/bank-reconciliation/connections", ["bank.connections"]],
    ["DELETE", "v1/bank-reconciliation/connections/1", ["bank.connections"]],
    ["GET", "v1/exports/pohoda.xml", ["reports.export"]],
    ["GET", "v1/exports/tax-return-basis.pdf", ["reports.export"]],
    ["POST", "v1/exports/annual-filings/dpfdp.xml", ["reports.export"]],
    ["GET", "v1/exports/annual-summary", []],
    ["POST", "v1/recurring-invoices", ["invoices.create"]],
    ["POST", "v1/time-entries/invoice", ["invoices.create"]],
    ["POST", "v1/time-entries", []],
    ["GET", "v1/tenants/me/number-formats", ["settings.numbering"]],
    ["PUT", "v1/tenants/me/number-formats", ["settings.numbering"]],
    ["PUT", "v1/tenants/me/logo", ["settings.company"]],
    ["POST", "v1/tenants/me/bank-accounts", ["settings.company"]],
    ["DELETE", "v1/tenants/me/bank-accounts/1", ["settings.company"]],
    ["PUT", "v1/tenants/me/card-payments", ["settings.paymentMethods"]],
    ["POST", "v1/tenants/me/card-payments/enabled", ["settings.paymentMethods"]],
    ["POST", "v1/tenants/me/einvoicing/register", ["settings.integrations"]],
    ["PUT", "v1/integrations/webhooks", ["settings.integrations"]],
    ["POST", "v1/integrations/webhooks/1/test", ["settings.integrations"]],
    ["POST", "v1/api-keys", ["settings.apiKeys"]],
    ["DELETE", "v1/api-keys/1", ["settings.apiKeys"]],
  ];

  it.each(cases)("%s %s needs %j", (method, path, actions) => {
    const req = requirementFor(method, path);
    expect(req).not.toBe("admin");
    expect(req && req !== "admin" ? req.actions : null).toEqual(actions);
  });

  it("uses the method for the level and the prefix for the area", () => {
    expect(requirementFor("GET", "v1/time-entries/summary")).toEqual({ area: "projects", level: "read", actions: [] });
    expect(requirementFor("GET", "v1/recurring-invoices")).toEqual({ area: "recurring", level: "read", actions: [] });
    expect(requirementFor("POST", "v1/bank-reconciliation/import")).toMatchObject({ area: "bank", level: "write" });
    expect(requirementFor("GET", "v1/invoices/1/pdf")).toEqual({ area: "invoices", level: "read", actions: [] });
  });

  it("leaves reads and unrelated writes outside the areas to the role", () => {
    expect(requirementFor("GET", "v1/tenants/me")).toBeNull();
    expect(requirementFor("GET", "v1/api-keys")).toBeNull();
    expect(requirementFor("POST", "v1/products")).toBeNull();
    expect(requirementFor("POST", "v1/integrations/feed")).toBeNull();
    expect(requirementFor("PUT", "v1/ai/settings")).toBeNull();
  });

  it("maps a company-settings patch by its fields", () => {
    expect(requirementFor("PATCH", "v1/tenants/me", { company_name: "A", ico: "1" })).toEqual({ area: "settings", level: "write", actions: ["settings.company"] });
    expect(requirementFor("PATCH", "v1/tenants/me", { template_vars: [], payment_methods: [] })).toEqual({
      area: "settings",
      level: "write",
      actions: ["settings.templates", "settings.paymentMethods"],
    });
    expect(requirementFor("PATCH", "v1/tenants/me", { enabled_modules: {} })).toBe("admin");
    expect(requirementFor("PATCH", "v1/tenants/me", { company_name: "A", enabled_modules: {} })).toBe("admin");
    expect(requirementFor("PATCH", "v1/tenants/me", { __proto__x: 1 })).toBe("admin");
    expect(sectionsForTenantPatch({ toString: 1 })).toBeNull();
  });

  it("names a section for every company-settings field except the admin-only ones", () => {
    const fields = Object.keys(updateTenantSchema.shape).filter((f) => !Object.prototype.hasOwnProperty.call(TENANT_FIELD_SECTIONS, f));
    expect(fields).toEqual(["enabled_modules"]);
  });
});

describe("meetsRequirement", () => {
  const invoicer = { invoices: "write", contacts: "write", expenses: "none", bank: "read", reports: "none", actions: { "invoices.issue": false, "invoices.cancel": false } };

  it("lets a drafter create and send but not issue or cancel", () => {
    expect(allowed("accountant", invoicer, "POST", "v1/invoices")).toBe(true);
    expect(allowed("accountant", invoicer, "POST", "v1/invoices/1/send")).toBe(true);
    expect(allowed("accountant", invoicer, "POST", "v1/invoices/1/issue")).toBe(false);
    expect(allowed("accountant", invoicer, "POST", "v1/invoices/1/cancel")).toBe(false);
    expect(allowed("accountant", invoicer, "DELETE", "v1/invoices/1")).toBe(false);
    expect(allowed("accountant", invoicer, "GET", "v1/invoices/1")).toBe(true);
  });

  it("needs invoices.create for work that makes invoices from another area", () => {
    const noDrafts = { actions: { "invoices.create": false } };
    expect(allowed("accountant", noDrafts, "POST", "v1/time-entries")).toBe(true);
    expect(allowed("accountant", noDrafts, "POST", "v1/time-entries/invoice")).toBe(false);
    expect(allowed("accountant", noDrafts, "POST", "v1/recurring-invoices")).toBe(false);
    expect(allowed("accountant", { invoices: "read", projects: "write" }, "POST", "v1/time-entries/invoice")).toBe(false);
  });

  it("keeps bank connections with admins unless granted", () => {
    expect(allowed("accountant", null, "POST", "v1/bank-reconciliation/connections")).toBe(false);
    expect(allowed("accountant", null, "POST", "v1/bank-reconciliation/connections/1/sync")).toBe(true);
    expect(allowed("accountant", { actions: { "bank.connections": true } }, "POST", "v1/bank-reconciliation/connections")).toBe(true);
    expect(allowed("viewer", { actions: { "bank.connections": true } }, "POST", "v1/bank-reconciliation/connections")).toBe(false);
  });

  it("grants settings sections one by one", () => {
    const numbering = { settings: "write", actions: { "settings.numbering": true } };
    expect(allowed("accountant", numbering, "PUT", "v1/tenants/me/number-formats")).toBe(true);
    expect(allowed("accountant", numbering, "GET", "v1/tenants/me/number-formats")).toBe(true);
    expect(allowed("accountant", null, "GET", "v1/tenants/me/number-formats")).toBe(false);
    expect(allowed("accountant", numbering, "PATCH", "v1/tenants/me", { company_name: "X" })).toBe(false);
    const both = { settings: "write", actions: { "settings.company": true, "settings.templates": true } };
    expect(allowed("accountant", both, "PATCH", "v1/tenants/me", { company_name: "X", template_vars: [] })).toBe(true);
    expect(allowed("accountant", both, "PATCH", "v1/tenants/me", { company_name: "X", payment_methods: [] })).toBe(false);
    expect(allowed("accountant", both, "PATCH", "v1/tenants/me", { enabled_modules: {} })).toBe(false);
    // A flag without the write level grants nothing.
    expect(allowed("accountant", { actions: { "settings.company": true } }, "POST", "v1/tenants/me/bank-accounts")).toBe(false);
  });

  it("lets reports be viewed without downloading", () => {
    const noExport = { actions: { "reports.export": false } };
    expect(allowed("viewer", noExport, "GET", "v1/exports/annual-summary")).toBe(true);
    expect(allowed("viewer", noExport, "GET", "v1/exports/annual-summary.csv")).toBe(false);
    expect(allowed("viewer", null, "GET", "v1/exports/annual-summary.csv")).toBe(true);
  });
});
