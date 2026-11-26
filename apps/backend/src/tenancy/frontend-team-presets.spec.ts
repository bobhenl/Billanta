import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { effectiveActions, effectivePermissions, permissionsSchema } from "./permissions";

type Access = { levels: Record<string, string>; flags: Record<string, boolean> };
interface Presets {
  effective(role: string, stored: unknown): Access;
  allowedActions(access: Access): Record<string, boolean>;
  presetOf(role: string, stored: unknown): string;
  toAssignment(access: Access): { role: string; permissions: Record<string, unknown> | null };
  TEAM_PRESETS: { key: string; role: string; access: Access }[];
}

// The team dialog (apps/frontend/lib/team-presets.ts) edits what the backend
// stores. If it reads stored values differently, the dialog shows one access
// and the guard enforces another.
describe("frontend team presets", () => {
  let p: Presets;
  beforeAll(async () => {
    // A computed path keeps the frontend file out of the backend's tsc program.
    p = (await import(join(__dirname, "../../../frontend/lib/team-presets.ts"))) as Presets;
  });

  const STORED: [string, unknown][] = [
    ["accountant", null],
    ["accountant", { expenses: "none", bank: "read", reports: "none" }],
    ["accountant", { invoices: "read", contacts: "read", bank: "none", reports: "none" }],
    ["accountant", { invoices: "read", projects: "write" }],
    ["accountant", { settings: "write", actions: { "settings.numbering": true, "invoices.issue": false } }],
    ["accountant", { bank: "read", actions: { "bank.connections": true } }],
    ["viewer", null],
    ["viewer", { bank: "none", reports: "none" }],
    ["viewer", { reports: "none", actions: { "reports.export": false } }],
  ];

  it("reads stored permissions the way the guard does", () => {
    for (const [role, stored] of STORED) {
      const access = p.effective(role, stored);
      expect(access.levels, `${role} ${JSON.stringify(stored)}`).toEqual(effectivePermissions(role, stored));
      expect(p.allowedActions(access), `${role} ${JSON.stringify(stored)}`).toEqual(effectiveActions(role, stored));
    }
  });

  it("still names members saved with the older presets", () => {
    expect(p.presetOf("accountant", null)).toBe("accountant");
    expect(p.presetOf("accountant", { expenses: "none", bank: "read", reports: "none" })).toBe("invoicer");
    expect(p.presetOf("accountant", { invoices: "read", contacts: "read", bank: "none", reports: "none" })).toBe("expenses");
    expect(p.presetOf("viewer", null)).toBe("auditor");
    expect(p.presetOf("viewer", { bank: "none", reports: "none" })).toBe("viewer");
    expect(p.presetOf("accountant", { invoices: "read", projects: "write" })).toBe("custom");
  });

  it("saves every preset and custom access so that it reads back the same and passes the schema", () => {
    const accesses = [...p.TEAM_PRESETS.filter((x) => x.role !== "admin").map((x) => x.access), ...STORED.map(([r, s]) => p.effective(r, s))];
    for (const access of accesses) {
      const { role, permissions } = p.toAssignment(access);
      expect(permissionsSchema.safeParse(permissions ?? {}).success).toBe(true);
      expect(effectivePermissions(role, permissions)).toEqual(access.levels);
      expect(effectiveActions(role, permissions)).toEqual(p.allowedActions(access));
    }
  });

  it("stores the assistant preset as draft-only invoicing", () => {
    const assistant = p.TEAM_PRESETS.find((x) => x.key === "assistant")!;
    const { role, permissions } = p.toAssignment(assistant.access);
    const actions = effectiveActions(role, permissions);
    expect(actions["invoices.create"]).toBe(true);
    expect(actions["invoices.issue"]).toBe(false);
    expect(actions["invoices.send"]).toBe(false);
    expect(actions["invoices.cancel"]).toBe(false);
    expect(p.presetOf(role, permissions)).toBe("assistant");
  });
});
