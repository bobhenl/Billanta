import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ACTION_KEYS,
  PERMISSION_ACTIONS,
  PERMISSION_AREAS,
  areaOfAction,
  effectiveActions,
  effectivePermissions,
  type Actions,
  type PermissionAction,
  type PermissionArea,
  type PermissionLevel,
} from "./permissions";
import { roleMayAccess } from "./role-access.guard";

type Access = { role: string; permissions: Partial<Record<PermissionArea, PermissionLevel>>; actions?: Partial<Actions> } | null;
type CanWrite = (access: Access, area: PermissionArea | null) => boolean;
type CanDo = (access: Access, action: PermissionAction) => boolean;

// The frontend hides buttons with `canWrite` and `canDo` (apps/frontend/lib/access.ts).
// If they drift from the guard, members see buttons that fail, or lose
// buttons they are allowed to use.
// Settings has no plain area route: every settings write is a section action (checked below).
const AREA_PATH: Record<Exclude<PermissionArea, "settings">, string> = {
  invoices: "v1/invoices",
  contacts: "v1/contacts",
  expenses: "v1/expenses",
  bank: "v1/bank-reconciliation/transactions",
  reports: "v1/exports",
  projects: "v1/time-entries",
  recurring: "v1/recurring-invoices",
};
const ACTION_ROUTE: Record<PermissionAction, [string, string, unknown?]> = {
  "invoices.create": ["POST", "v1/invoices"],
  "invoices.issue": ["POST", "v1/invoices/x/issue"],
  "invoices.send": ["POST", "v1/invoices/x/send"],
  "invoices.cancel": ["POST", "v1/invoices/x/cancel"],
  "expenses.create": ["POST", "v1/expenses"],
  "expenses.approve": ["POST", "v1/expenses/einvoices/incoming/x/accept"],
  "expenses.delete": ["DELETE", "v1/expenses/x"],
  "bank.match": ["POST", "v1/bank-reconciliation/transactions/x/match"],
  "bank.connections": ["POST", "v1/bank-reconciliation/connections"],
  "reports.export": ["GET", "v1/exports/invoices.csv"],
  "settings.company": ["POST", "v1/tenants/me/logo"],
  "settings.numbering": ["PUT", "v1/tenants/me/number-formats"],
  "settings.templates": ["PATCH", "v1/tenants/me", { email_prefs: {} }],
  "settings.paymentMethods": ["PUT", "v1/tenants/me/card-payments"],
  "settings.integrations": ["POST", "v1/integrations/webhooks"],
  "settings.apiKeys": ["POST", "v1/api-keys"],
};
const ROLES = ["owner", "admin", "service", "accountant", "viewer", "unknown"];
const LEVELS: (PermissionLevel | undefined)[] = [undefined, "none", "read", "write"];
const FLAGS: (boolean | undefined)[] = [undefined, false, true];

// What GET /tenants/me/access hands the frontend.
const accessOf = (role: string, overrides?: unknown) => ({
  role,
  permissions: effectivePermissions(role, overrides),
  actions: effectiveActions(role, overrides),
});

describe("frontend canWrite and canDo", () => {
  let canWrite: CanWrite;
  let canDo: CanDo;
  let front: { PERMISSION_AREAS: readonly string[]; PERMISSION_ACTIONS: Record<string, string> };
  beforeAll(async () => {
    // A computed path keeps the frontend file out of the backend's tsc program.
    const file = join(__dirname, "../../../frontend/lib/access.ts");
    front = (await import(file)) as typeof front;
    ({ canWrite, canDo } = front as unknown as { canWrite: CanWrite; canDo: CanDo });
  });

  it("canWrite matches roleMayAccess for every role, area and override", () => {
    for (const role of ROLES) {
      for (const area of Object.keys(AREA_PATH) as (keyof typeof AREA_PATH)[]) {
        for (const level of LEVELS) {
          const overrides = level ? { [area]: level } : undefined;
          const expected = roleMayAccess(role, "POST", AREA_PATH[area], overrides);
          expect(canWrite(accessOf(role, overrides), area), `${role} ${area} ${level ?? "default"}`).toBe(expected);
        }
      }
      expect(canWrite(accessOf(role), null), `${role} outside the areas`).toBe(roleMayAccess(role, "POST", "v1/products", undefined));
    }
  });

  it("canDo matches roleMayAccess for every role, action, flag and area level", () => {
    for (const role of ROLES) {
      for (const action of ACTION_KEYS) {
        const area = areaOfAction(action);
        const [method, path, body] = ACTION_ROUTE[action];
        for (const level of LEVELS) {
          for (const flag of FLAGS) {
            const overrides = { ...(level ? { [area]: level } : {}), ...(flag === undefined ? {} : { actions: { [action]: flag } }) };
            const expected = roleMayAccess(role, method, path, overrides, body);
            expect(canDo(accessOf(role, overrides), action), `${role} ${action} ${level ?? "default"} ${flag ?? "default"}`).toBe(expected);
          }
        }
      }
    }
  });

  it("canDo without an actions map falls back to the area level (an older backend)", () => {
    const access = { role: "accountant", permissions: { invoices: "read" as const, reports: "read" as const } };
    expect(canDo(access, "invoices.issue")).toBe(false);
    expect(canDo(access, "reports.export")).toBe(true);
    expect(canDo({ role: "accountant", permissions: { invoices: "write" } }, "invoices.issue")).toBe(true);
  });

  it("allows everything when access is unknown, leaving the decision to the backend", () => {
    expect(canWrite(null, "invoices")).toBe(true);
    expect(canWrite(null, null)).toBe(true);
    expect(canDo(null, "invoices.issue")).toBe(true);
  });

  it("has the same areas and actions as the backend", () => {
    expect([...front.PERMISSION_AREAS]).toEqual([...PERMISSION_AREAS]);
    expect(front.PERMISSION_ACTIONS).toEqual(PERMISSION_ACTIONS);
  });
});
