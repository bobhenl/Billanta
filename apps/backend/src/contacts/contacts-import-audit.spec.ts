import { describe, expect, it, vi } from "vitest";
import { ContactsService } from "./contacts.service";

/** The existing contacts are the only select; inserts return a fresh id, updates resolve. */
function fakeDb(existing: { id: string; ico: string | null; legalName: string }[]) {
  let n = 0;
  const thenable = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "values", "set", "returning"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown) => Promise.resolve(typeof result === "function" ? result() : result).then(ok);
    return c;
  };
  return {
    select: () => thenable(existing),
    insert: () => thenable(() => [{ id: `new-${++n}` }]),
    update: () => thenable(undefined),
  };
}

const csv = (text: string) => Buffer.from(text, "utf-8");

describe("ContactsService.importCsv audit entry", () => {
  it("records one import entry with created, updated and skipped counts", async () => {
    const audit = { record: vi.fn() };
    const service = new ContactsService({} as never, audit as never);
    const db = fakeDb([{ id: "c1", ico: null, legalName: "Alfa s.r.o." }]);
    const out = await service.importCsv(db as never, "t1", csv("Název;E-mail\nAlfa s.r.o.;a@alfa.cz\nBeta;\nGama;\nDelta;nope"));
    expect(out).toMatchObject({ created: 2, updated: 1 });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(db, "t1", {
      entityType: "import",
      action: "contacts_csv",
      changes: [
        { field: "importedContacts", from: null, to: 2 },
        { field: "updatedContacts", from: null, to: 1 },
        { field: "skippedRows", from: null, to: 1 },
      ],
    });
  });

  it("leaves out the counts that are zero", async () => {
    const audit = { record: vi.fn() };
    const service = new ContactsService({} as never, audit as never);
    await service.importCsv(fakeDb([]) as never, "t1", csv("Název\nAlfa"));
    expect(audit.record.mock.calls[0]![2].changes).toEqual([{ field: "importedContacts", from: null, to: 1 }]);
  });

  it("records nothing when every row was skipped", async () => {
    const audit = { record: vi.fn() };
    const service = new ContactsService({} as never, audit as never);
    await service.importCsv(fakeDb([]) as never, "t1", csv("Název;E-mail\nAlfa;nope"));
    expect(audit.record).not.toHaveBeenCalled();
  });
});
