import type { JwtService } from "@nestjs/jwt";
import { describe, expect, it, vi } from "vitest";
import { ContactsService } from "../contacts/contacts.service";
import { InvoicesService } from "../invoices/invoices.service";
import { TeamService } from "../team/team.service";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { VaultService } from "../vault/vault.service";
import { assertStepUp, hasFreshStepUp, STEP_UP_WINDOW_MINUTES } from "./step-up";
import { verifyBearerToken } from "./verify-bearer-token";

vi.mock("../abuse/sending-guard", () => ({
  assertCanSendEmail: vi.fn(async () => undefined),
  recordEmailSent: vi.fn(async () => undefined),
}));
// The vault answers with its status after each change; the plan lookup is not what is tested here.
vi.mock("../billing/plan.guard", async (original) => ({ ...(await original<object>()), loadPlanSummary: vi.fn(async () => null) }));

const OWNER = "00000000-0000-4000-8000-000000000001";
const SELLER = "00000000-0000-4000-8000-000000000004";
const NOW = Date.now();

const owner: AuthenticatedUser = { id: OWNER, tenantId: "t1", role: "owner", unlocked: true };
/** The owner a moment after typing the TOTP code. */
const stepped = { ...owner, stepUpAt: NOW - 60_000, stepUpMethod: "totp" as const };
/** The same proof, but older than the window. */
const stale = { ...owner, stepUpAt: NOW - (STEP_UP_WINDOW_MINUTES + 1) * 60_000, stepUpMethod: "totp" as const };

/** A drizzle stand-in: selects and deletes resolve to queued results; writes are recorded, an update returns the row it set. */
function fakeDb(selects: unknown[][], deletes: unknown[][] = []) {
  const writes: { op: string; value?: unknown }[] = [];
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "limit", "returning", "orderBy", "onConflictDoNothing"]) c[m] = () => c;
    c.set = (v: unknown) => {
      writes.push({ op: "update", value: v });
      return c;
    };
    c.values = (v: unknown) => {
      writes.push({ op: "insert", value: v });
      return c;
    };
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(result).then(ok, fail);
    return c;
  };
  return {
    writes,
    select: () => chain(() => selects.shift() ?? []),
    update: () => chain(() => [{ id: "i1", tenantId: "t1", ...(writes.at(-1)?.value as object) }]),
    insert: () => chain(() => []),
    delete: () => {
      writes.push({ op: "delete" });
      return chain(() => deletes.shift() ?? []);
    },
  };
}

const audit = () => ({ record: vi.fn(async () => undefined) });
const stepUpLine = { field: "stepUp", from: null, to: "totp" };
const refused = { status: 403, message: "step_up_required" };

describe("hasFreshStepUp", () => {
  it("accepts a proof from the last few minutes only", () => {
    expect(hasFreshStepUp(stepped, NOW)).toBe(true);
    expect(hasFreshStepUp(stale, NOW)).toBe(false);
    expect(hasFreshStepUp(owner, NOW)).toBe(false);
    expect(hasFreshStepUp(undefined, NOW)).toBe(false);
  });

  it("refuses a time far in the future and a time without a method", () => {
    expect(hasFreshStepUp({ stepUpAt: NOW + 10 * 60_000, stepUpMethod: "password" }, NOW)).toBe(false);
    expect(hasFreshStepUp({ stepUpAt: NOW }, NOW)).toBe(false);
  });

  it("throws step_up_required and otherwise returns the method", () => {
    expect(() => assertStepUp(owner, NOW)).toThrow("step_up_required");
    expect(assertStepUp({ stepUpAt: NOW, stepUpMethod: "password" }, NOW)).toBe("password");
  });
});

describe("the sa and sm claims", () => {
  const jwt = (payload: object) => ({ verify: () => payload }) as unknown as JwtService;
  const read = (extra: object) => verifyBearerToken(jwt({ sub: "u", email: "a@b.cz", ...extra }), "Bearer x");

  it("turn into stepUpAt (ms) and stepUpMethod only together and only with a known method", () => {
    expect(read({ sa: 1_800_000_000, sm: "totp" })).toMatchObject({ stepUpAt: 1_800_000_000_000, stepUpMethod: "totp" });
    expect(read({ sa: 1_800_000_000 }).stepUpAt).toBeUndefined();
    expect(read({ sa: "1800000000", sm: "totp" }).stepUpAt).toBeUndefined();
    expect(read({ sa: 1_800_000_000, sm: "sms" }).stepUpMethod).toBeUndefined();
  });
});

describe("removing an invoice lock", () => {
  const invoice = { id: "i1", tenantId: "t1", invoiceNumber: "2026001", documentType: "invoice", lockedAt: new Date(), createdByUserId: OWNER };
  const service = (log = audit()) => new InvoicesService({} as never, {} as never, undefined, undefined, log as never);

  it("is refused without a fresh step-up and writes nothing", async () => {
    for (const who of [owner, stale]) {
      const db = fakeDb([[invoice]]);
      await expect(service().setLock(db as never, "i1", false, who as never)).rejects.toMatchObject(refused);
      expect(db.writes).toHaveLength(0);
    }
  });

  it("goes through with one, and the history says how it was confirmed", async () => {
    const log = audit();
    const db = fakeDb([[invoice]]);
    await expect(service(log).setLock(db as never, "i1", false, stepped as never)).resolves.toEqual({ id: "i1", locked: false });
    expect(db.writes[0]).toMatchObject({ op: "update", value: { lockedAt: null } });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "unlocked", changes: [stepUpLine] }));
  });

  it("is not needed to lock", async () => {
    const db = fakeDb([[{ ...invoice, lockedAt: null }]]);
    await expect(service().setLock(db as never, "i1", true, owner as never)).resolves.toEqual({ id: "i1", locked: true });
  });
});

describe("switching an invoice's privacy", () => {
  const invoice = { id: "i1", tenantId: "t1", invoiceNumber: "2026001", documentType: "invoice", createdByUserId: SELLER, isPrivate: true };
  const service = (log = audit()) => new InvoicesService({} as never, {} as never, undefined, undefined, log as never);

  it("is refused without a fresh step-up and writes nothing", async () => {
    const db = fakeDb([[invoice]]);
    await expect(service().setPrivate(db as never, "i1", false, owner as never)).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
  });

  it("goes through with one, audited", async () => {
    const log = audit();
    const db = fakeDb([[invoice]]);
    await expect(service(log).setPrivate(db as never, "i1", false, stepped as never)).resolves.toEqual({ id: "i1", isPrivate: false });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "made_shared", changes: expect.arrayContaining([stepUpLine]) }));
  });
});

describe("a client's owner and privacy", () => {
  const contact = { id: "c1", tenantId: "t1", legalName: "Tajný klient s.r.o.", ownerUserId: SELLER, isPrivate: true };

  it("are refused without a fresh step-up and nothing is written", async () => {
    const db = fakeDb([[contact]]);
    await expect(new ContactsService({} as never, audit() as never).setVisibility(db as never, owner as never, "c1", { isPrivate: false })).rejects.toMatchObject(
      refused,
    );
    expect(db.writes).toHaveLength(0);
  });

  it("change with one, audited", async () => {
    const log = audit();
    const db = fakeDb([[contact], [{ id: "m1" }]]);
    await new ContactsService({} as never, log as never).setVisibility(db as never, stepped as never, "c1", { ownerUserId: OWNER });
    expect(db.writes[0]).toMatchObject({ op: "update", value: { ownerUserId: OWNER } });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "visibility_changed", changes: expect.arrayContaining([stepUpLine]) }));
  });
});

describe("a member's contact scope", () => {
  const member = { id: "m1", userId: SELLER, role: "accountant", contactScope: "own", permissions: null };

  it("is refused without a fresh step-up, also through the side doors", async () => {
    const service = new TeamService({} as never, {} as never, undefined, audit() as never);
    const db = fakeDb([[member]]);
    await expect(service.updateMember(db as never, owner as never, "m1", "accountant", null, "all")).rejects.toMatchObject(refused);
    await expect(service.updateMember(fakeDb([[member]]) as never, owner as never, "m1", "admin", null)).rejects.toMatchObject(refused);
    await expect(service.removeMember(fakeDb([[member]]) as never, owner as never, "m1")).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
  });

  it("changes with one, audited", async () => {
    const log = audit();
    const db = fakeDb([[member], [{ email: "s@example.cz" }]]);
    await new TeamService({} as never, {} as never, undefined, log as never).updateMember(db as never, stepped as never, "m1", "accountant", null, "all");
    expect(db.writes[0]).toMatchObject({ op: "update", value: { contactScope: "all" } });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ changes: expect.arrayContaining([stepUpLine]) }));
  });

  it("is not touched by other team changes, which need no step-up", async () => {
    const service = new TeamService({} as never, {} as never, undefined, audit() as never);
    await expect(service.updateMember(fakeDb([[{ ...member, contactScope: "all" }], [{ email: "s@example.cz" }]]) as never, owner as never, "m1", "viewer", null)).resolves.toEqual({
      ok: true,
    });
  });
});

describe("Confidential mode", () => {
  const vault = { tenantId: "t1", sealNew: true, emailMode: "link_now", autoSendPdf: false, categories: ["texts"], keyCheck: "k", createdAt: new Date() };
  const passkey = { id: "w1", kind: "passkey", label: "Telefon" };

  it("refuses removing an unlock method without a fresh step-up", async () => {
    const db = fakeDb([]);
    await expect(new VaultService(audit() as never).removeWrap(db as never, "t1", owner as never, "w1")).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
  });

  it("removes one with a step-up and audits it", async () => {
    const log = audit();
    const db = fakeDb([[vault], []], [[passkey]]);
    await new VaultService(log as never).removeWrap(db as never, "t1", stepped as never, "w1");
    expect(db.writes).toContainEqual({ op: "delete" });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "vault_wrap_removed", changes: expect.arrayContaining([stepUpLine]) }));
  });

  it("refuses replacing the recovery code without a fresh step-up", async () => {
    const db = fakeDb([[vault]]);
    const recovery = { kind: "recovery", kdf: "raw", salt: "s", iv: "i", wrappedKey: "w" };
    await expect(new VaultService(audit() as never).replaceRecovery(db as never, "t1", owner as never, { recovery } as never)).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
    const log = audit();
    const ok = fakeDb([[vault], [vault], []]);
    await new VaultService(log as never).replaceRecovery(ok as never, "t1", stepped as never, { recovery } as never);
    expect(log.record).toHaveBeenCalledWith(ok, "t1", expect.objectContaining({ action: "vault_recovery_replaced", changes: [stepUpLine] }));
  });

  it("refuses replacing an existing vault password without one, but lets a first password through", async () => {
    const wrap = { kind: "password", kdf: "pbkdf2", iterations: 600000, salt: "s", iv: "i", wrappedKey: "w" };
    const db = fakeDb([[vault], [{ id: "w0" }]]);
    await expect(new VaultService(audit() as never).addWrap(db as never, "t1", owner as never, wrap as never)).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
    await expect(new VaultService().addWrap(fakeDb([[vault], []]) as never, "t1", owner as never, wrap as never)).resolves.toBeDefined();
    const log = audit();
    const ok = fakeDb([[vault], [{ id: "w0" }]]);
    await new VaultService(log as never).addWrap(ok as never, "t1", stepped as never, wrap as never);
    expect(log.record).toHaveBeenCalledWith(ok, "t1", expect.objectContaining({ action: "vault_password_replaced", changes: [stepUpLine] }));
  });

  it("refuses switching encryption of new documents off without one; switching it on needs none", async () => {
    const db = fakeDb([[vault]]);
    await expect(new VaultService(audit() as never).updateSettings(db as never, "t1", owner as never, { sealNew: false })).rejects.toMatchObject(refused);
    expect(db.writes).toHaveLength(0);
    await expect(new VaultService().updateSettings(fakeDb([[{ ...vault, sealNew: false }]]) as never, "t1", owner as never, { sealNew: true })).resolves.toBeDefined();
    const log = audit();
    const ok = fakeDb([[vault]]);
    await new VaultService(log as never).updateSettings(ok as never, "t1", stepped as never, { sealNew: false });
    expect(ok.writes[0]).toMatchObject({ op: "update", value: { sealNew: false } });
    expect(log.record).toHaveBeenCalledWith(ok, "t1", expect.objectContaining({ action: "vault_seal_new_off", changes: expect.arrayContaining([stepUpLine]) }));
  });
});
