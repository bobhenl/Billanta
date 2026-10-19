import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_AREAS, effectivePermissions, type PermissionArea, type PermissionLevel } from "./permissions";
import { roleMayAccess } from "./role-access.guard";

type CanWrite = (access: { role: string; permissions: Partial<Record<PermissionArea, PermissionLevel>> } | null, area: PermissionArea | null) => boolean;

// The frontend hides write buttons with `canWrite` (apps/frontend/lib/access.ts).
// If it drifts from the guard, read-only members see buttons that fail, or
// writers lose buttons they are allowed to use.
const AREA_PATH: Record<PermissionArea, string> = {
  invoices: "v1/invoices",
  contacts: "v1/contacts",
  expenses: "v1/expenses",
  bank: "v1/bank-reconciliation/transactions",
  reports: "v1/exports",
};
const ROLES = ["owner", "admin", "service", "accountant", "viewer", "unknown"];
const LEVELS: (PermissionLevel | undefined)[] = [undefined, "none", "read", "write"];

describe("frontend canWrite", () => {
  let canWrite: CanWrite;
  beforeAll(async () => {
    // A computed path keeps the frontend file out of the backend's tsc program.
    const file = join(__dirname, "../../../frontend/lib/access.ts");
    canWrite = ((await import(file)) as { canWrite: CanWrite }).canWrite;
  });

  it("matches roleMayAccess for every role, area and override", () => {
    for (const role of ROLES) {
      for (const area of PERMISSION_AREAS) {
        for (const level of LEVELS) {
          const overrides = level ? { [area]: level } : undefined;
          // The frontend gets the effective permissions from GET /tenants/me/access.
          const access = { role, permissions: effectivePermissions(role, overrides) };
          const expected = roleMayAccess(role, "POST", AREA_PATH[area], overrides);
          expect(canWrite(access, area), `${role} ${area} ${level ?? "default"}`).toBe(expected);
        }
      }
      const access = { role, permissions: effectivePermissions(role) };
      expect(canWrite(access, null), `${role} outside the areas`).toBe(roleMayAccess(role, "POST", "v1/products", undefined));
    }
  });

  it("allows everything when access is unknown, leaving the decision to the backend", () => {
    expect(canWrite(null, "invoices")).toBe(true);
    expect(canWrite(null, null)).toBe(true);
  });
});
