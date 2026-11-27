import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { VaultService } from "./vault.service";

const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(20 + n)}` as const;

/** Answers each `.limit()` / `.returning()` / awaited query in turn with the next rows. */
function fakeDb(...answers: unknown[][]) {
  const wheres: SQL[] = [];
  const sets: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const next = () => Promise.resolve(answers.shift() ?? []);
  for (const m of ["select", "from", "innerJoin", "orderBy", "update"]) chain[m] = () => chain;
  chain.set = (v: unknown) => {
    sets.push(v);
    return chain;
  };
  chain.where = (w: SQL) => {
    wheres.push(w);
    return chain;
  };
  chain.limit = next;
  chain.returning = next;
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);
  return { db: chain as never, wheres, sets };
}

const vaultRow = (categories: string[]) => [{ tenantId: "t1", categories }];
const plainContact = { id: "c1", legalName: "Novák s.r.o.", addressStreet: "Dlouhá 5", addressCity: "Brno", addressPostalCode: "60200", contactPerson: null, phone: null, internalNote: null, email: "a@b.cz" };

describe("VaultService.sealContacts", () => {
  it("refuses without the contacts category (403 vault_category_off)", async () => {
    const { db, sets } = fakeDb(vaultRow(["texts"]), [{ categories: ["texts"] }]);
    const error = await new VaultService().sealContacts(db, "t1", { contacts: [{ id: "c1", legalName: env(1) }], invoices: [] }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as Error).message).toBe("vault_category_off");
    expect(sets).toEqual([]);
  });

  it("stores only the sealable columns, and only while the name is still plain", async () => {
    const { db, sets, wheres } = fakeDb(vaultRow(["contacts"]), [{ categories: ["contacts"] }], [plainContact], [{ id: "c1" }]);
    const given = { id: "c1", legalName: env(1), addressStreet: env(2), addressCity: env(3), addressPostalCode: env(4), phone: env(5) };
    const result = await new VaultService().sealContacts(db, "t1", { contacts: [given], invoices: [] });
    expect(result).toMatchObject({ contacts: 1 });
    // phone was empty: an envelope for it is not written, and the e-mail stays as it is
    expect(sets).toEqual([{ legalName: env(1), addressStreet: env(2), addressCity: env(3), addressPostalCode: env(4) }]);
    const where = new PgDialect().sqlToQuery(wheres.at(-1)!).sql;
    expect(where).toContain("NOT LIKE 'enc:v1:%'");
  });

  it("is idempotent: an already encrypted contact is skipped", async () => {
    const { db, sets } = fakeDb(vaultRow(["contacts"]), [{ categories: ["contacts"] }], [{ ...plainContact, legalName: env(9) }]);
    const result = await new VaultService().sealContacts(db, "t1", { contacts: [{ id: "c1", legalName: env(1) }], invoices: [] });
    expect(result).toMatchObject({ contacts: 0 });
    expect(sets).toEqual([]);
  });

  it("refuses to leave a plain column behind (400 contact_plaintext)", async () => {
    const { db, sets } = fakeDb(vaultRow(["contacts"]), [{ categories: ["contacts"] }], [plainContact]);
    const error = await new VaultService().sealContacts(db, "t1", { contacts: [{ id: "c1", legalName: env(1), addressCity: env(3) }], invoices: [] }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe("contact_plaintext");
    expect(sets).toEqual([]);
  });

  it("seals a document's buyer snapshot only once its contact is encrypted", async () => {
    const doc = { id: "i1", invoiceNumber: "2026-0001", buyerSnapshot: { legalName: "Novák s.r.o.", addressCity: "Brno", ico: "27604977" }, buyerContactPerson: null };
    const plainOwner = fakeDb(vaultRow(["contacts"]), [{ categories: ["contacts"] }], [{ ...doc, contactName: "Novák s.r.o." }]);
    const skipped = await new VaultService().sealContacts(plainOwner.db, "t1", { contacts: [], invoices: [{ id: "i1", buyer: { legalName: env(1), addressCity: env(2) } }] });
    expect(skipped).toMatchObject({ invoices: 0 });
    expect(plainOwner.sets).toEqual([]);

    const sealedOwner = fakeDb(vaultRow(["contacts"]), [{ categories: ["contacts"] }], [{ ...doc, contactName: env(7) }], []);
    const done = await new VaultService().sealContacts(sealedOwner.db, "t1", { contacts: [], invoices: [{ id: "i1", buyer: { legalName: env(1), addressCity: env(2) } }] });
    expect(done).toMatchObject({ invoices: 1 });
    expect(sealedOwner.sets).toEqual([{ buyerSnapshot: { legalName: env(1), addressCity: env(2), ico: "27604977" } }]);
  });
});

describe("VaultService.plainContacts", () => {
  it("refuses without the contacts category", async () => {
    const { db } = fakeDb(vaultRow(["texts", "attachments"]));
    const error = await new VaultService().plainContacts(db, "t1", { limit: 20 }).catch((e: Error) => e);
    expect((error as Error).message).toBe("vault_category_off");
  });
});
