import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ContactsService } from "../contacts/contacts.service";
import { contactVisibilitySchema } from "../contacts/dto/contact-visibility.dto";
import { InvoicesService } from "../invoices/invoices.service";
import { linksToRecord, membersNotSeeing } from "../notifications/notifications.service";
import { scopeChangeRefused, TeamService } from "../team/team.service";
import { roleMayAccess } from "./role-access.guard";
import { mayChangeContactVisibility, mayChangeInvoicePrivacy, visibilityError } from "./visibility";

vi.mock("../abuse/sending-guard", () => ({
  assertCanSendEmail: vi.fn(async () => undefined),
  recordEmailSent: vi.fn(async () => undefined),
}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000002";
const ACCOUNTANT = "00000000-0000-4000-8000-000000000003";
const SELLER = "00000000-0000-4000-8000-000000000004";

const actor = (id: string, role: string) => ({ id, tenantId: "t1", role }) as never;
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

describe("scopeChangeRefused", () => {
  const own = { role: "accountant", contactScope: "own" };
  const all = { role: "accountant", contactScope: "all" };
  it("lets the owner do anything", () => {
    expect(scopeChangeRefused("owner", own, { contactScope: "all" })).toBe(false);
    expect(scopeChangeRefused("owner", own, { role: "admin" })).toBe(false);
    expect(scopeChangeRefused("owner", own, { removed: true })).toBe(false);
  });
  it("refuses an admin widening or narrowing anyone's clients", () => {
    expect(scopeChangeRefused("admin", own, { contactScope: "all" })).toBe(true);
    expect(scopeChangeRefused("admin", all, { contactScope: "own" })).toBe(true);
  });
  it("refuses an admin the side doors: promoting a limited member to admin, or showing them out", () => {
    expect(scopeChangeRefused("admin", own, { role: "admin" })).toBe(true);
    expect(scopeChangeRefused("admin", own, { removed: true })).toBe(true);
  });
  it("leaves an admin the rest of the team management", () => {
    expect(scopeChangeRefused("admin", own, { role: "viewer", contactScope: "own" })).toBe(false);
    expect(scopeChangeRefused("admin", all, { role: "admin" })).toBe(false);
    expect(scopeChangeRefused("admin", all, { removed: true })).toBe(false);
  });
});

describe("TeamService contact scope", () => {
  const member = { id: "m1", userId: SELLER, role: "accountant", contactScope: "own", permissions: null };

  it("refuses an admin changing contactScope with 403 owner_only and writes nothing", async () => {
    const db = fakeDb([[member]]);
    const service = new TeamService({} as never, {} as never, undefined, audit() as never);
    await expect(service.updateMember(db as never, admin, "m1", "accountant", null, "all")).rejects.toMatchObject({
      status: 403,
      message: "owner_only",
    });
    expect(db.updates).toHaveLength(0);
  });

  it("refuses an accountant outright (team management is owner/admin)", async () => {
    const db = fakeDb([[member]]);
    const service = new TeamService({} as never, {} as never);
    await expect(service.updateMember(db as never, accountant, "m1", "accountant", null, "all")).rejects.toBeInstanceOf(ForbiddenException);
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

  it("lets the owner change it and records who changed what", async () => {
    const log = audit();
    const db = fakeDb([[member], [{ email: "s@example.cz" }]]);
    const service = new TeamService({} as never, {} as never, undefined, log as never);
    await service.updateMember(db as never, owner, "m1", "accountant", null, "all");
    expect(db.updates[0]).toMatchObject({ contactScope: "all" });
    expect(log.record).toHaveBeenCalledWith(
      db,
      "t1",
      expect.objectContaining({ entityId: SELLER, changes: expect.arrayContaining([{ field: "contactScope", from: "own", to: "all" }]) }),
    );
  });
});

describe("who may change a client's or an invoice's visibility", () => {
  it("is the company owner or the record's own person, never an API key", () => {
    expect(mayChangeContactVisibility(owner, { ownerUserId: null })).toBe(true);
    expect(mayChangeContactVisibility(seller, { ownerUserId: SELLER })).toBe(true);
    expect(mayChangeContactVisibility(admin, { ownerUserId: SELLER })).toBe(false);
    expect(mayChangeContactVisibility(admin, { ownerUserId: null })).toBe(false);
    expect(mayChangeContactVisibility({ id: OWNER, role: "owner", apiKey: true } as never, { ownerUserId: null })).toBe(false);
    expect(mayChangeInvoicePrivacy(seller, { createdByUserId: SELLER })).toBe(true);
    expect(mayChangeInvoicePrivacy(accountant, { createdByUserId: null })).toBe(false);
  });

  it("maps database refusals to stable codes", () => {
    expect(visibilityError({ code: "42501", message: "visibility_owner_only" })).toMatchObject({ message: "visibility_owner_only" });
    expect(visibilityError({ cause: { code: "42501", message: 'new row violates row-level security policy for table "contacts"' } })).toMatchObject({
      message: "visibility_would_hide",
    });
    const other = { code: "23505" };
    expect(visibilityError(other)).toBe(other);
  });

  it("requires something to change in the request body", () => {
    expect(contactVisibilitySchema.safeParse({}).success).toBe(false);
    expect(contactVisibilitySchema.safeParse({ isPrivate: true }).success).toBe(true);
  });
});

describe("ContactsService.setVisibility", () => {
  const contact = { id: "c1", tenantId: "t1", legalName: "Tajný klient s.r.o.", ownerUserId: SELLER, isPrivate: false };

  it.each([
    ["an admin", admin],
    ["an accountant", accountant],
  ])("refuses %s who isn't the client's owner with 403 and writes nothing", async (_, who) => {
    const db = fakeDb([[contact]]);
    const service = new ContactsService({} as never, audit() as never);
    await expect(service.setVisibility(db as never, who, "c1", { isPrivate: true })).rejects.toMatchObject({ status: 403, message: "visibility_owner_only" });
    await expect(service.setVisibility(fakeDb([[contact]]) as never, who, "c1", { ownerUserId: ACCOUNTANT })).rejects.toMatchObject({ status: 403 });
    expect(db.updates).toHaveLength(0);
  });

  it("lets the client's owner mark it private, and audits it", async () => {
    const log = audit();
    const db = fakeDb([[contact]]);
    const service = new ContactsService({} as never, log as never);
    await service.setVisibility(db as never, seller, "c1", { isPrivate: true });
    expect(db.updates[0]).toMatchObject({ isPrivate: true });
    expect(log.record).toHaveBeenCalledWith(
      db,
      "t1",
      expect.objectContaining({ entityId: "c1", action: "visibility_changed", changes: [{ field: "isPrivate", from: false, to: true }] }),
    );
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

  it("turns the policy refusing a member's give-away into 403 visibility_would_hide", async () => {
    const service = new ContactsService({} as never);
    const db = fakeDb([[{ ...contact, isPrivate: true }], [{ id: "m3" }]], { code: "42501", message: "new row violates row-level security policy" });
    await expect(service.setVisibility(db as never, seller, "c1", { ownerUserId: ACCOUNTANT })).rejects.toMatchObject({ status: 403, message: "visibility_would_hide" });
  });
});

describe("InvoicesService.setPrivate", () => {
  const invoice = { id: "i1", tenantId: "t1", invoiceNumber: "2026001", documentType: "invoice", createdByUserId: SELLER, isPrivate: false };
  const service = (log = audit()) => new InvoicesService({} as never, {} as never, undefined, undefined, log as never);

  it.each([
    ["an admin", admin],
    ["an accountant", accountant],
  ])("refuses %s who didn't create it with 403 and writes nothing", async (_, who) => {
    const db = fakeDb([[invoice]]);
    await expect(service().setPrivate(db as never, "i1", true, who)).rejects.toMatchObject({ status: 403, message: "visibility_owner_only" });
    expect(db.updates).toHaveLength(0);
  });

  it("lets the creator and the company owner switch it, with a history line", async () => {
    const log = audit();
    const db = fakeDb([[invoice]]);
    await expect(service(log).setPrivate(db as never, "i1", true, seller)).resolves.toEqual({ id: "i1", isPrivate: true });
    expect(db.updates[0]).toEqual({ isPrivate: true });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "made_private", changes: [{ field: "isPrivate", from: false, to: true }] }));
    const db2 = fakeDb([[{ ...invoice, isPrivate: true }]]);
    await service().setPrivate(db2 as never, "i1", false, owner);
    expect(db2.updates[0]).toEqual({ isPrivate: false });
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
  it("lets an accountant reach the visibility endpoints (the service then checks ownership)", () => {
    expect(roleMayAccess("accountant", "PATCH", "v1/contacts/c1/visibility")).toBe(true);
    expect(roleMayAccess("accountant", "PATCH", "v1/invoices/i1/private")).toBe(true);
  });
  it("keeps the team member update to owner and admin", () => {
    expect(roleMayAccess("accountant", "PATCH", "v1/team/members/m1")).toBe(false);
    expect(roleMayAccess("viewer", "PATCH", "v1/team/members/m1")).toBe(false);
  });
});
