import type { JwtService } from "@nestjs/jwt";
import { describe, expect, it } from "vitest";
import { verifyBearerToken } from "../auth/verify-bearer-token";
import { roleMayAccess } from "../tenancy/role-access.guard";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { lockBlocks, maskLockedRow } from "./invoice-lock";

const owner: AuthenticatedUser = { id: "u", tenantId: "t", role: "owner" };
const lockedAt = new Date("2026-11-20T10:00:00Z");

describe("lockBlocks", () => {
  it("lets anyone open an invoice that is not locked", () => {
    expect(lockBlocks(null, owner)).toBe(false);
  });

  it("stops even the owner until they re-authenticate", () => {
    expect(lockBlocks(lockedAt, owner)).toBe(true);
    expect(lockBlocks(lockedAt, { ...owner, unlocked: true })).toBe(false);
  });

  it("lets integrations through: an API key is not a person at an open laptop", () => {
    expect(lockBlocks(lockedAt, { ...owner, role: "service", apiKey: true })).toBe(false);
  });
});

describe("maskLockedRow", () => {
  const row = { id: "i", lockedAt, contactName: "Novák s.r.o.", contactIco: "12345678", internalNote: "sleva", total: 1210 };

  it("hides who a locked invoice is for but keeps its amount for the totals", () => {
    const masked = maskLockedRow(row, owner);
    expect(masked).toMatchObject({ locked: true, contactName: null, contactIco: null, internalNote: null, total: 1210 });
  });

  it("shows the row in full once the viewer re-authenticated, still flagged", () => {
    expect(maskLockedRow(row, { ...owner, unlocked: true })).toMatchObject({ locked: true, contactName: "Novák s.r.o.", internalNote: "sleva" });
  });

  it("leaves an unlocked row as it is", () => {
    expect(maskLockedRow({ ...row, lockedAt: null }, owner)).toMatchObject({ locked: false, contactName: "Novák s.r.o." });
  });
});

describe("the ul claim", () => {
  const jwt = (payload: object) => ({ verify: () => payload }) as unknown as JwtService;

  it("marks the user unlocked only for a literal true", () => {
    expect(verifyBearerToken(jwt({ sub: "u", email: "a@b.cz", ul: true }), "Bearer x").unlocked).toBe(true);
    expect(verifyBearerToken(jwt({ sub: "u", email: "a@b.cz", ul: "true" }), "Bearer x").unlocked).toBe(false);
    expect(verifyBearerToken(jwt({ sub: "u", email: "a@b.cz" }), "Bearer x").unlocked).toBe(false);
  });
});

describe("who may lock", () => {
  it("is owner and admin only", () => {
    expect(roleMayAccess("owner", "PATCH", "v1/invoices/abc/lock")).toBe(true);
    expect(roleMayAccess("admin", "PATCH", "v1/invoices/abc/lock")).toBe(true);
    expect(roleMayAccess("accountant", "PATCH", "v1/invoices/abc/lock", { invoices: "write" })).toBe(false);
  });
});
