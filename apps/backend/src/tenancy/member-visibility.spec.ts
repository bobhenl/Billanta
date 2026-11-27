import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContactsService } from "../contacts/contacts.service";
import { contactVisibilitySchema } from "../contacts/dto/contact-visibility.dto";
import { ExpensesService } from "../expenses/expenses.service";
import { InvoicesService } from "../invoices/invoices.service";
import { linksToRecord, membersNotSeeing } from "../notifications/notifications.service";
import { changedScopes, scopeChangeRefused, TeamService, widensScopes } from "../team/team.service";
import { updateMemberSchema } from "../team/dto/create-invitation.dto";
import { accessLockSchema } from "./access-lock.dto";
import { roleMayAccess } from "./role-access.guard";
import { lockWidens, mayChangeContactOwner, mayChangeLock, rlsRefusal, visibilityError } from "./visibility";

vi.mock("../abuse/sending-guard", () => ({
  assertCanSendEmail: vi.fn(async () => undefined),
  recordEmailSent: vi.fn(async () => undefined),
}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000002";
const ACCOUNTANT = "00000000-0000-4000-8000-000000000003";
const SELLER = "00000000-0000-4000-8000-000000000004";

// Everyone here confirmed a second factor a moment ago: the step-up has its own spec (src/auth/step-up.spec.ts).
const actor = (id: string, role: string) => ({ id, tenantId: "t1", role, stepUpAt: Date.now(), stepUpMethod: "totp" }) as never;
const owner = actor(OWNER, "owner");
const admin = actor(ADMIN, "admin");
const accountant = actor(ACCOUNTANT, "accountant");
const seller = actor(SELLER, "accountant");

/** A drizzle stand-in: selects resolve to queued results, updates are recorded (or throw `updateError`). */
function fakeDb(selects: unknown[][], updateError?: unknown) {
  const updates: unknown[] = [];
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "limit", "values", "returning", "orderBy"]) c[m] = () => c;
    c.set = (v: unknown) => {
      updates.push(v);
      return c;
    };
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(result).then(ok, fail);
    return c;
  };
  return {
    updates,
    select: () => chain(() => selects.shift() ?? []),
    update: () =>
      chain(() => {
        if (updateError) throw updateError;
        return [];
      }),
    delete: () => chain(() => undefined),
  };
}

const audit = () => ({ record: vi.fn(async () => undefined) });
const scoped = (contactScope: string, invoiceScope = "all", expenseScope = "all", role = "accountant") => ({ role, contactScope, invoiceScope, expenseScope });

describe("scopeChangeRefused", () => {
  const own = scoped("own");
  const all = scoped("all");
  it("lets the owner do anything", () => {
    expect(scopeChangeRefused("owner", own, { scopes: { contacts: "all" } })).toBe(false);
    expect(scopeChangeRefused("owner", own, { role: "admin" })).toBe(false);
    expect(scopeChangeRefused("owner", own, { removed: true })).toBe(false);
  });
  it("refuses an admin widening or narrowing any area", () => {
    expect(scopeChangeRefused("admin", own, { scopes: { contacts: "all" } })).toBe(true);
    expect(scopeChangeRefused("admin", all, { scopes: { contacts: "own" } })).toBe(true);
    expect(scopeChangeRefused("admin", all, { scopes: { invoices: "edit_own" } })).toBe(true);
    expect(scopeChangeRefused("admin", all, { scopes: { expenses: "own" } })).toBe(true);
  });
  it("refuses an admin the side doors: promoting a limited member to admin, or showing them out", () => {
    expect(scopeChangeRefused("admin", own, { role: "admin" })).toBe(true);
    expect(scopeChangeRefused("admin", own, { removed: true })).toBe(true);
    // edit_own is a limit too: as an admin they would edit everything.
    expect(scopeChangeRefused("admin", scoped("all", "edit_own"), { role: "admin" })).toBe(true);
    expect(scopeChangeRefused("admin", scoped("all", "all", "own"), { removed: true })).toBe(true);
  });
  it("leaves an admin the rest of the team management", () => {
    expect(scopeChangeRefused("admin", own, { role: "viewer", scopes: { contacts: "own" } })).toBe(false);
    expect(scopeChangeRefused("admin", all, { role: "admin" })).toBe(false);
    expect(scopeChangeRefused("admin", all, { removed: true })).toBe(false);
  });
});

describe("widensScopes (needs a step-up)", () => {
  it("is any area opening up, never one closing", () => {
    expect(widensScopes(scoped("own"), { scopes: { contacts: "edit_own" } })).toBe(true);
    expect(widensScopes(scoped("all", "edit_own"), { scopes: { invoices: "all" } })).toBe(true);
    expect(widensScopes(scoped("all", "all", "own"), { scopes: { expenses: "all" } })).toBe(true);
    expect(widensScopes(scoped("all"), { scopes: { contacts: "own", invoices: "edit_own" } })).toBe(false);
    expect(widensScopes(scoped("all", "edit_own"), { scopes: { invoices: "own" } })).toBe(false);
  });
  it("is one opening up even when another closes in the same change", () => {
    expect(widensScopes(scoped("own", "all"), { scopes: { contacts: "all", invoices: "own" } })).toBe(true);
  });
  it("counts the side doors only for a limited member", () => {
    expect(widensScopes(scoped("all", "own"), { role: "admin" })).toBe(true);
    expect(widensScopes(scoped("all"), { role: "admin" })).toBe(false);
    expect(widensScopes(scoped("all"), { removed: true })).toBe(false);
  });
  it("ignores areas the request leaves out or doesn't change", () => {
    expect(changedScopes(scoped("own", "edit_own"), { contacts: "own", invoices: undefined })).toEqual([]);
    expect(changedScopes(scoped("own", "edit_own"), { invoices: "all" })).toEqual(["invoices"]);
  });
});

describe("TeamService scopes", () => {
  const member = { id: "m1", userId: SELLER, ...scoped("own", "edit_own", "all"), permissions: null };

  it("refuses an admin changing a scope with 403 owner_only and writes nothing", async () => {
    for (const scopes of [{ contacts: "all" }, { invoices: "own" }, { expenses: "edit_own" }] as const) {
      const db = fakeDb([[member]]);
      const service = new TeamService({} as never, {} as never, undefined, audit() as never);
      await expect(service.updateMember(db as never, admin, "m1", "accountant", null, scopes)).rejects.toMatchObject({ status: 403, message: "owner_only" });
      expect(db.updates).toHaveLength(0);
    }
  });

  it("refuses an accountant outright (team management is owner/admin)", async () => {
    const db = fakeDb([[member]]);
    const service = new TeamService({} as never, {} as never);
    await expect(service.updateMember(db as never, accountant, "m1", "accountant", null, { contacts: "all" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.updates).toHaveLength(0);
  });

  it("refuses an admin promoting a limited member to admin", async () => {
    const db = fakeDb([[member]]);
    const service = new TeamService({} as never, {} as never);
    await expect(service.updateMember(db as never, admin, "m1", "admin", null)).rejects.toMatchObject({ status: 403, message: "owner_only" });
  });

  it("refuses an admin removing a limited member, but lets the member leave", async () => {
    const service = new TeamService({} as never, {} as never);
    await expect(service.removeMember(fakeDb([[member]]) as never, admin, "m1")).rejects.toMatchObject({ status: 403, message: "owner_only" });
    await expect(service.removeMember(fakeDb([[member], [{ email: "s@example.cz" }]]) as never, seller, "m1")).resolves.toEqual({ ok: true });
  });

  it("lets the owner change them, writes only what changed and records it per area", async () => {
    const log = audit();
    const db = fakeDb([[member], [{ email: "s@example.cz" }]]);
    const service = new TeamService({} as never, {} as never, undefined, log as never);
    await service.updateMember(db as never, owner, "m1", "accountant", null, { contacts: "all", invoices: "edit_own", expenses: "own" });
    expect(db.updates[0]).toMatchObject({ contactScope: "all", expenseScope: "own" });
    expect(db.updates[0]).not.toHaveProperty("invoiceScope");
    expect(log.record).toHaveBeenCalledWith(
      db,
      "t1",
      expect.objectContaining({
        entityId: SELLER,
        changes: expect.arrayContaining([
          { field: "contactScope", from: "own", to: "all" },
          { field: "expenseScope", from: "all", to: "own" },
        ]),
      }),
    );
  });

  it("takes all three values per area and nothing else", () => {
    expect(updateMemberSchema.safeParse({ role: "accountant", scopes: { invoices: "edit_own", expenses: "own" } }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ role: "accountant", contactScope: "edit_own" }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ role: "accountant", scopes: { invoices: "mine" } }).success).toBe(false);
  });
});

describe("who may change a client's owner or a record's lock", () => {
  const open = { person: SELLER, accessLock: null, accessLockUserId: null };
  const locked = { person: SELLER, accessLock: "admin" as const, accessLockUserId: ADMIN };

  it("hands a client over: the company owner, or its own person while it has no lock; never an API key", () => {
    expect(mayChangeContactOwner(owner, { ownerUserId: null, accessLock: "private" })).toBe(true);
    expect(mayChangeContactOwner(seller, { ownerUserId: SELLER, accessLock: null })).toBe(true);
    expect(mayChangeContactOwner(seller, { ownerUserId: SELLER, accessLock: "private" })).toBe(false);
    expect(mayChangeContactOwner(admin, { ownerUserId: SELLER, accessLock: null })).toBe(false);
    expect(mayChangeContactOwner(admin, { ownerUserId: null, accessLock: null })).toBe(false);
    expect(mayChangeContactOwner({ id: OWNER, role: "owner", apiKey: true } as never, { ownerUserId: null, accessLock: null })).toBe(false);
  });

  it("locks an open record: its person or a manager, not another member", () => {
    expect(mayChangeLock(seller, open)).toBe(true);
    expect(mayChangeLock(admin, open)).toBe(true);
    expect(mayChangeLock(owner, open)).toBe(true);
    expect(mayChangeLock(accountant, open)).toBe(false);
    expect(mayChangeLock(accountant, { ...open, person: null })).toBe(false);
  });

  it("changes a lock: its holder or the company owner, not even the record's person or an admin", () => {
    expect(mayChangeLock(admin, locked)).toBe(true);
    expect(mayChangeLock(owner, locked)).toBe(true);
    expect(mayChangeLock(seller, locked)).toBe(false);
    expect(mayChangeLock(actor("00000000-0000-4000-8000-000000000009", "admin"), locked)).toBe(false);
    expect(mayChangeLock({ id: OWNER, role: "owner", apiKey: true } as never, locked)).toBe(false);
  });

  it("widens when more people get in, from the fewest: private, admin, accountant, no lock", () => {
    expect(lockWidens("private", "admin")).toBe(true);
    expect(lockWidens("admin", "accountant")).toBe(true);
    expect(lockWidens("accountant", null)).toBe(true);
    expect(lockWidens("private", null)).toBe(true);
    expect(lockWidens(null, "accountant")).toBe(false);
    expect(lockWidens("accountant", "private")).toBe(false);
    expect(lockWidens("admin", "admin")).toBe(false);
  });

  it("maps database refusals to stable codes", () => {
    expect(visibilityError({ code: "42501", message: "visibility_owner_only" })).toMatchObject({ message: "visibility_owner_only" });
    expect(visibilityError({ cause: { code: "42501", message: 'new row violates row-level security policy for table "contacts"' } })).toMatchObject({
      message: "visibility_would_hide",
    });
    expect(rlsRefusal({ cause: { code: "42501", message: 'new row violates row-level security policy "member_edit_scope_update" for table "invoices"' } })).toMatchObject({
      status: 403,
      message: "record_read_only",
    });
    // A missing grant is a bug, not a refusal to word.
    expect(rlsRefusal({ code: "42501", message: "permission denied for table invoices" })).toBeNull();
    const other = { code: "23505" };
    expect(visibilityError(other)).toBe(other);
  });

  it("requires something to change in the request body, and only known levels", () => {
    expect(contactVisibilitySchema.safeParse({}).success).toBe(false);
    expect(contactVisibilitySchema.safeParse({ accessLock: "private" }).success).toBe(true);
    expect(contactVisibilitySchema.safeParse({ accessLock: null }).success).toBe(true);
    expect(accessLockSchema.safeParse({ level: "accountant" }).success).toBe(true);
    expect(accessLockSchema.safeParse({ level: null }).success).toBe(true);
    expect(accessLockSchema.safeParse({ level: "viewer" }).success).toBe(false);
  });
});

describe("ContactsService.setVisibility", () => {
  const contact = { id: "c1", tenantId: "t1", legalName: "Tajný klient s.r.o.", ownerUserId: SELLER, accessLock: null, accessLockUserId: null };

  it("refuses an accountant who isn't the client's owner with 403 and writes nothing", async () => {
    const db = fakeDb([[contact]]);
    const service = new ContactsService({} as never, audit() as never);
    await expect(service.setVisibility(db as never, accountant, "c1", { accessLock: "private" })).rejects.toMatchObject({ status: 403, message: "visibility_owner_only" });
    await expect(service.setVisibility(fakeDb([[contact]]) as never, accountant, "c1", { ownerUserId: ACCOUNTANT })).rejects.toMatchObject({ status: 403 });
    expect(db.updates).toHaveLength(0);
  });

  it("refuses an admin handing someone's client over", async () => {
    const service = new ContactsService({} as never);
    await expect(service.setVisibility(fakeDb([[contact]]) as never, admin, "c1", { ownerUserId: ADMIN })).rejects.toMatchObject({ status: 403 });
  });

  it("lets the client's owner lock it in their own name, and audits it", async () => {
    const log = audit();
    const db = fakeDb([[contact]]);
    const service = new ContactsService({} as never, log as never);
    await service.setVisibility(db as never, seller, "c1", { accessLock: "private" });
    expect(db.updates[0]).toMatchObject({ accessLock: "private", accessLockUserId: SELLER });
    expect(log.record).toHaveBeenCalledWith(
      db,
      "t1",
      expect.objectContaining({ entityId: "c1", action: "visibility_changed", changes: expect.arrayContaining([{ field: "accessLock", from: null, to: "private" }]) }),
    );
  });

  it("refuses the client's owner lifting a lock someone else holds", async () => {
    const service = new ContactsService({} as never);
    const db = fakeDb([[{ ...contact, accessLock: "admin", accessLockUserId: ADMIN }]]);
    await expect(service.setVisibility(db as never, seller, "c1", { accessLock: null })).rejects.toMatchObject({ status: 403, message: "visibility_owner_only" });
    expect(db.updates).toHaveLength(0);
  });

  it("lets the company owner hand it to a member, but only to a member", async () => {
    const service = new ContactsService({} as never);
    const db = fakeDb([[contact], [{ id: "m3" }]]);
    await service.setVisibility(db as never, owner, "c1", { ownerUserId: ACCOUNTANT });
    expect(db.updates[0]).toMatchObject({ ownerUserId: ACCOUNTANT });
    await expect(service.setVisibility(fakeDb([[contact], []]) as never, owner, "c1", { ownerUserId: ACCOUNTANT })).rejects.toMatchObject({
      status: 400,
      message: "owner_not_member",
    });
  });

  it("moves the lock with a locked client handed over by the company owner", async () => {
    const service = new ContactsService({} as never);
    const db = fakeDb([[{ ...contact, accessLock: "private", accessLockUserId: SELLER }], [{ id: "m3" }]]);
    await service.setVisibility(db as never, owner, "c1", { ownerUserId: ACCOUNTANT });
    expect(db.updates[0]).toMatchObject({ ownerUserId: ACCOUNTANT, accessLockUserId: ACCOUNTANT });
    expect(db.updates[0]).not.toHaveProperty("accessLock");
    // A lock someone else holds stays theirs.
    const db2 = fakeDb([[{ ...contact, accessLock: "admin", accessLockUserId: ADMIN }], [{ id: "m3" }]]);
    await service.setVisibility(db2 as never, owner, "c1", { ownerUserId: ACCOUNTANT });
    expect(db2.updates[0]).not.toHaveProperty("accessLockUserId");
  });

  it("turns the policy refusing a member's give-away into 403 visibility_would_hide", async () => {
    const service = new ContactsService({} as never);
    const db = fakeDb([[contact], [{ id: "m3" }]], { code: "42501", message: "new row violates row-level security policy" });
    await expect(service.setVisibility(db as never, seller, "c1", { ownerUserId: ACCOUNTANT })).rejects.toMatchObject({ status: 403, message: "visibility_would_hide" });
  });
});

describe("InvoicesService.setAccessLock", () => {
  const invoice = { id: "i1", tenantId: "t1", invoiceNumber: "2026001", documentType: "invoice", createdByUserId: SELLER, accessLock: null, accessLockUserId: null };
  const service = (log = audit()) => new InvoicesService({} as never, {} as never, undefined, undefined, log as never);

  it("refuses a member who didn't create it with 403 and writes nothing", async () => {
    const db = fakeDb([[invoice]]);
    await expect(service().setAccessLock(db as never, "i1", "private", accountant)).rejects.toMatchObject({ status: 403, message: "visibility_owner_only" });
    expect(db.updates).toHaveLength(0);
  });

  it("lets the creator lock it in their name, with a history line", async () => {
    const log = audit();
    const db = fakeDb([[invoice]]);
    await expect(service(log).setAccessLock(db as never, "i1", "admin", seller)).resolves.toEqual({ id: "i1", accessLock: "admin" });
    expect(db.updates[0]).toEqual({ accessLock: "admin", accessLockUserId: SELLER });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "made_private", changes: expect.arrayContaining([{ field: "accessLock", from: null, to: "admin" }]) }));
  });

  it("lets an admin lock it, and only the holder or the company owner lift it", async () => {
    const db = fakeDb([[invoice]]);
    await service().setAccessLock(db as never, "i1", "private", admin);
    expect(db.updates[0]).toEqual({ accessLock: "private", accessLockUserId: ADMIN });
    const held = { ...invoice, accessLock: "private", accessLockUserId: ADMIN };
    await expect(service().setAccessLock(fakeDb([[held]]) as never, "i1", null, seller)).rejects.toMatchObject({ status: 403 });
    const db2 = fakeDb([[held]]);
    await service().setAccessLock(db2 as never, "i1", null, owner);
    expect(db2.updates[0]).toEqual({ accessLock: null, accessLockUserId: null });
  });
});

describe("ExpensesService.setAccessLock", () => {
  const expense = { id: "e1", tenantId: "t1", description: "Nájem", documentNumber: null, createdByUserId: SELLER, accessLock: null, accessLockUserId: null };

  it("follows the invoice rules and audits as an expense", async () => {
    const log = audit();
    const db = fakeDb([[expense]]);
    await new ExpensesService(log as never).setAccessLock(db as never, "e1", "accountant", seller);
    expect(db.updates[0]).toEqual({ accessLock: "accountant", accessLockUserId: SELLER });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ entityType: "expense", entityId: "e1", action: "made_private" }));
    await expect(new ExpensesService().setAccessLock(fakeDb([[expense]]) as never, "e1", "private", accountant)).rejects.toMatchObject({ status: 403 });
  });
});

describe("notifications about records some members can't see", () => {
  it("knows which links point at one record", () => {
    expect(linksToRecord("/invoices/0b6f1f5e-8f4e-4c3a-9d0e-1a2b3c4d5e6f")).toBe(true);
    expect(linksToRecord("/contacts/0b6f1f5e-8f4e-4c3a-9d0e-1a2b3c4d5e6f?tab=x")).toBe(true);
    expect(linksToRecord("/bank")).toBe(false);
    expect(linksToRecord(null)).toBe(false);
  });

  it("asks the database as each member and resets the user afterwards", async () => {
    const calls: unknown[][] = [];
    let current = "";
    const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      if (strings[0]!.includes("set_config")) {
        current = String(values[0] ?? "");
        return Promise.resolve([]);
      }
      return Promise.resolve([{ hidden: current === SELLER }]);
    }) as never;
    const hidden = await membersNotSeeing(tx, [OWNER, SELLER], "/invoices/0b6f1f5e-8f4e-4c3a-9d0e-1a2b3c4d5e6f");
    expect([...hidden]).toEqual([SELLER]);
    expect(current).toBe("");
    expect(await membersNotSeeing(tx, [SELLER], "/bank")).toEqual(new Set());
  });
});

describe("route guard leaves the decision to the services", () => {
  it("lets an accountant reach the visibility and lock endpoints (the service then checks ownership)", () => {
    expect(roleMayAccess("accountant", "PATCH", "v1/contacts/c1/visibility")).toBe(true);
    expect(roleMayAccess("accountant", "PATCH", "v1/invoices/i1/access-lock")).toBe(true);
    expect(roleMayAccess("accountant", "PATCH", "v1/expenses/e1/access-lock")).toBe(true);
  });
  it("keeps the team member update to owner and admin", () => {
    expect(roleMayAccess("accountant", "PATCH", "v1/team/members/m1")).toBe(false);
    expect(roleMayAccess("viewer", "PATCH", "v1/team/members/m1")).toBe(false);
  });
});
