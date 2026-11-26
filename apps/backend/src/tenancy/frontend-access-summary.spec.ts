import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_AREAS, accessSummary } from "./permissions";

type Summary = typeof accessSummary;

// The invite page reads the invitation straight from the database and builds
// the access list with the frontend copy of `accessSummary`; the e-mail uses
// this one. If they drift, the page and the e-mail promise different access.
const ROLES = ["owner", "admin", "service", "accountant", "viewer", "unknown"];
const OVERRIDES: unknown[] = [
  undefined,
  null,
  {},
  { invoices: "none" },
  { bank: "read", reports: "none" },
  { contacts: "write", expenses: "read" },
  { invoices: "none", contacts: "none", expenses: "none", bank: "none", reports: "none" },
  { invoices: "admin" },
  { secrets: "write" },
  { invoices: "none", secrets: "write" },
  "write",
  ["invoices"],
];

describe("accessSummary", () => {
  it("lists every area with the role's level and marks who manages the team", () => {
    expect(accessSummary("viewer")).toEqual({ manage: false, areas: PERMISSION_AREAS.map((area) => ({ area, level: "read" })) });
    expect(accessSummary("admin").manage).toBe(true);
    expect(accessSummary("owner").manage).toBe(true);
    expect(accessSummary("accountant").manage).toBe(false);
  });

  it("applies overrides for a normal role but never for an owner or admin", () => {
    const levels = (s: ReturnType<Summary>) => Object.fromEntries(s.areas.map((a) => [a.area, a.level]));
    expect(levels(accessSummary("accountant", { bank: "none", reports: "read" }))).toEqual({
      invoices: "write",
      contacts: "write",
      expenses: "write",
      bank: "none",
      reports: "read",
      // Projects and recurring follow invoices; an accountant reads settings by default.
      projects: "write",
      recurring: "write",
      settings: "read",
    });
    expect(levels(accessSummary("admin", { bank: "none" })).bank).toBe("write");
    // A broken override is ignored as a whole, like the guard does.
    expect(levels(accessSummary("viewer", { bank: "write", secrets: "write" })).bank).toBe("read");
  });
});

describe("frontend accessSummary", () => {
  let frontend: Summary;
  beforeAll(async () => {
    // A computed path keeps the frontend file out of the backend's tsc program.
    const file = join(__dirname, "../../../frontend/lib/access.ts");
    frontend = ((await import(file)) as { accessSummary: Summary }).accessSummary;
  });

  it("matches the backend for every role and override", () => {
    for (const role of ROLES) {
      for (const overrides of OVERRIDES) {
        expect(frontend(role, overrides), `${role} ${JSON.stringify(overrides)}`).toEqual(accessSummary(role, overrides));
      }
    }
  });
});
