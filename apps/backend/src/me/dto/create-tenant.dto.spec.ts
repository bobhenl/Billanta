import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CURRENT_TOS_VERSION, createTenantSchema } from "./create-tenant.dto";

describe("createTenantSchema", () => {
  it("matches the version the frontend sends", () => {
    const tos = readFileSync(join(__dirname, "../../../../frontend/lib/tos.ts"), "utf8");
    expect(tos).toContain(`export const TOS_VERSION = '${CURRENT_TOS_VERSION}';`);
  });

  it("refuses any other terms version", () => {
    expect(createTenantSchema.safeParse({ companyName: "A", tosVersion: CURRENT_TOS_VERSION }).success).toBe(true);
    expect(createTenantSchema.safeParse({ companyName: "A", tosVersion: "anything" }).success).toBe(false);
  });
});
