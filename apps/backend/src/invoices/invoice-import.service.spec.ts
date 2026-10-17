import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { InvoiceImportService } from "./invoice-import.service";
import type { ImportedContact, ImportedInvoice } from "./invoice-import.util";

const source = (id: number, number: string) => ({ id, number }) as never;

/** Runs the BitFaktura import with the invoice writes stubbed, so only the PDF archiving is exercised. */
async function run(pdfFor: (url: string) => Response | Promise<Response>, dryRun = false) {
  const service = new InvoiceImportService();
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  let contacts: unknown;
  const db = { insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => void inserted.push({ table, values }) }) };
  vi.spyOn(service as never, "importMapped").mockImplementation((async (
    _db: unknown,
    _tenant: string,
    mapped: { invoices: ImportedInvoice[] },
    _dry: boolean,
    onCreated?: (inv: ImportedInvoice, id: string) => void,
    _contacts?: unknown,
  ) => {
    contacts = _contacts;
    if (!_dry) mapped.invoices.forEach((inv, i) => onCreated?.(inv, `inv-${i}`));
    return { dryRun: _dry, invoices: mapped.invoices.length };
  }) as never);
  const fetcher = async (url: string) => {
    if (url.includes("/clients.json")) return new Response(JSON.stringify([{ id: 5, name: "Klient bez faktury" }]), { status: 200 });
    if (url.includes("/invoices.json")) {
      return new Response(JSON.stringify([source(11, "1/10/2026"), source(12, "2/10/2026"), source(13, "3/10/2026")]), { status: 200 });
    }
    return pdfFor(url);
  };
  // The stubbed importMapped receives whatever the mapper produced; give it complete invoices.
  vi.spyOn(await import("./bitfaktura-import"), "mapBitfakturaInvoices").mockImplementation((src) => ({
    invoices: (src as { id: number; number: string }[]).map((s) => ({ invoiceNumber: s.number, sourceId: s.id }) as ImportedInvoice),
    skipped: [],
  }));
  const result = await service.importFromBitfaktura(db as never, "tenant-1", "firma", "t0ken-xyz", dryRun, fetcher as never);
  return { result, inserted, contacts };
}

describe("InvoiceImportService.importFromBitfaktura – original PDFs", () => {
  it("stores each original PDF as a private archive attachment and counts the missing ones", async () => {
    const { result, inserted } = await run((url) =>
      url.endsWith("/12.pdf") ? new Response("not found", { status: 404 }) : new Response(`%PDF-1.4 ${url}`, { status: 200 }),
    );
    expect(result.originalPdfs).toEqual({ archived: 2, missing: 1 });
    expect(inserted.every((r) => r.table === schema.invoiceAttachments)).toBe(true);
    const rows = inserted.map((r) => r.values).sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    expect(rows.map((r) => [r.filename, r.invoiceId, r.tenantId, r.mime, r.sendWithEmail, r.showInPortal])).toEqual([
      ["1-10-2026-bitfaktura.pdf", "inv-0", "tenant-1", "application/pdf", false, false],
      ["3-10-2026-bitfaktura.pdf", "inv-2", "tenant-1", "application/pdf", false, false],
    ]);
    expect(Buffer.from(String(rows[1]!.data), "base64").toString()).toBe("%PDF-1.4 https://firma.bitfaktura.cz/invoices/13.pdf");
    expect(rows[1]!.sizeBytes).toBe(Buffer.from(String(rows[1]!.data), "base64").length);
  });

  it("downloads nothing on a preview", async () => {
    const { result, inserted, contacts } = await run(() => {
      throw new Error("must not download on a dry run");
    }, true);
    expect(contacts).toEqual([expect.objectContaining({ legalName: "Klient bez faktury" })]);
    expect(result.source).toEqual({ invoices: 3, contacts: 1 });
    expect(result.originalPdfs).toBeUndefined();
    expect(inserted).toEqual([]);
  });
});

describe("InvoiceImportService.importMapped – address-book contacts", () => {
  const contact = (legalName: string, ico: string | null = null, over: Partial<ImportedContact> = {}): ImportedContact => ({
    legalName,
    ico,
    dic: null,
    email: null,
    addressStreet: null,
    addressCity: null,
    addressPostalCode: null,
    addressCountry: "CZ",
    ...over,
  });
  const invoiceFor = (customer: ImportedContact) =>
    ({
      line: 1,
      invoiceNumber: `F-${customer.legalName}`,
      status: "issued",
      currency: "CZK",
      issueDate: new Date("2026-10-01"),
      lines: [{ quantity: 1, unitPrice: 100, vatRate: 0 }],
      customer,
    }) as unknown as ImportedInvoice;

  /** Just enough of Drizzle for the contact part: existing contacts, no taken numbers, inserts returning ids. */
  function fakeDb(existing: { id: string; ico: string | null; legalName: string }[]) {
    const created: Record<string, unknown>[] = [];
    const db = {
      select: () => ({
        from: (table: unknown) => Object.assign(Promise.resolve(table === schema.contacts ? existing : []), { where: async () => [] }),
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => ({
          returning: async () => {
            created.push(v);
            return [{ id: `new-${created.length}` }];
          },
        }),
      }),
    };
    return { db, created };
  }
  type Result = { contactsCreated: number; contactsMatched: number };
  const importMapped = (db: unknown, invoices: ImportedInvoice[], dryRun: boolean, contacts: ImportedContact[]) =>
    (new InvoiceImportService() as unknown as { importMapped: (...a: unknown[]) => Promise<Result> }).importMapped(
      db,
      "tenant-1",
      { invoices, skipped: [] },
      dryRun,
      undefined,
      contacts,
    );

  const book = [contact("Acme s.r.o.", "27082440", { internalNote: "Tel. 777" }), contact("Jan Novák", null, { isPerson: true }), contact("Existing Ltd")];

  it("counts contacts never invoiced, and a buyer who is also in the address book once", async () => {
    const { db, created } = fakeDb([{ id: "old-1", ico: null, legalName: "Existing Ltd " }]);
    // Same IČO under another name, same name without the IČO, same name with an IČO the book lacks.
    const buyers = [contact("ACME", "27082440"), contact("acme s.r.o."), contact("Jan Novák", "12345678")];
    const result = await importMapped(db, buyers.map(invoiceFor), true, book);
    expect(result).toMatchObject({ contactsCreated: 2, contactsMatched: 1 });
    expect(created).toEqual([]);
  });

  it("refuses an address book over the import limit", async () => {
    const { db } = fakeDb([]);
    await expect(importMapped(db, [], true, Array.from({ length: 5001 }, (_, i) => contact(`c${i}`)))).rejects.toMatchObject({
      response: { error: "too_many_rows" },
    });
    await expect(importMapped(db, [], true, Array.from({ length: 5000 }, (_, i) => contact(`c${i}`)))).resolves.toMatchObject({ contactsCreated: 5000 });
  });

  it("creates the address-book contacts that are missing, with what only the address book knows", async () => {
    const { db, created } = fakeDb([{ id: "old-1", ico: null, legalName: "Existing Ltd" }]);
    const result = await importMapped(db, [], false, book);
    expect(result).toMatchObject({ contactsCreated: 2, contactsMatched: 1 });
    expect(created).toEqual([
      expect.objectContaining({ tenantId: "tenant-1", legalName: "Acme s.r.o.", ico: "27082440", internalNote: "Tel. 777" }),
      expect.objectContaining({ tenantId: "tenant-1", legalName: "Jan Novák", isPerson: true }),
    ]);
  });
});
