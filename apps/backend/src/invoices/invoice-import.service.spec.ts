import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { businessFill, csvBuyerSnapshot, InvoiceImportService } from "./invoice-import.service";
import type { ImportedContact, ImportedInvoice } from "./invoice-import.util";

const source = (id: number, number: string) => ({ id, number }) as never;
const EMPTY_TENANT = { ico: null, dic: null, registryNote: null, addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ" };
const SELLER = {
  id: 1,
  main: true,
  name: "Jan Novák",
  tax_no: "CZ8001011234",
  register_number: "12345678",
  street: "Dlouhá 1",
  city: "Praha",
  post_code: "110 00",
  additional_fields: { seller_trade_register_cz: "Fyzická osoba zapsaná v živnostenském rejstříku." },
};

/** Runs the BitFaktura import with the invoice writes stubbed, so only the PDF archiving is exercised. */
async function run(
  pdfFor: (url: string) => Response | Promise<Response>,
  dryRun = false,
  tenantRow: Record<string, string | null> = EMPTY_TENANT,
  audit?: { record: (...a: unknown[]) => Promise<void> },
) {
  const service = new InvoiceImportService(audit as never);
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  let contacts: unknown;
  const updated: Record<string, unknown>[] = [];
  const db = {
    insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => void inserted.push({ table, values }) }),
    select: () => ({ from: () => ({ where: async () => [tenantRow] }) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({ where: async () => void updated.push({ table, ...values }) }),
    }),
  };
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
    if (url.includes("/departments.json")) return new Response(JSON.stringify([SELLER]), { status: 200 });
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
  return { result, inserted, contacts, updated };
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

describe("InvoiceImportService – audit log entry per import run", () => {
  const pdf = () => new Response("%PDF-1.4", { status: 200 });

  it("records one BitFaktura entry with counts and the business fields it filled", async () => {
    const record = vi.fn(async (..._args: unknown[]) => undefined);
    await run(pdf, false, EMPTY_TENANT, { record });
    expect(record).toHaveBeenCalledTimes(1);
    const [, tenantId, entry] = record.mock.calls[0] as unknown as [unknown, string, { entityType: string; action: string; changes: { field: string; to: unknown }[] }];
    expect(tenantId).toBe("tenant-1");
    expect(entry.entityType).toBe("import");
    expect(entry.action).toBe("bitfaktura");
    const byField = Object.fromEntries(entry.changes.map((c) => [c.field, c.to]));
    expect(byField).toMatchObject({ importedInvoices: 3, archivedPdfs: 3, ico: "12345678", dic: "CZ8001011234", addressCity: "Praha" });
  });

  it("records nothing on a preview", async () => {
    const record = vi.fn(async (..._args: unknown[]) => undefined);
    await run(pdf, true, EMPTY_TENANT, { record });
    expect(record).not.toHaveBeenCalled();
  });

  it("records a CSV run, and skips a preview or a run that brought nothing in", async () => {
    const record = vi.fn(async (..._args: unknown[]) => undefined);
    const service = new InvoiceImportService({ record } as never);
    const results = [
      { dryRun: false, invoices: 2, contactsCreated: 1, skipped: [{ line: 3 }] },
      { dryRun: false, invoices: 0, contactsCreated: 0, skipped: [{ line: 2 }] },
      { dryRun: true, invoices: 2, contactsCreated: 1, skipped: [] },
    ];
    vi.spyOn(service as never, "importMapped").mockImplementation((async () => results.shift()) as never);
    const csv = Buffer.from("Číslo faktury;Odběratel;Datum vystavení;Celkem\nF1;Firma;1.10.2026;100\n");
    await service.importCsv({} as never, "tenant-1", csv, false);
    await service.importCsv({} as never, "tenant-1", csv, false);
    await service.importCsv({} as never, "tenant-1", csv, true);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![2]).toEqual({
      entityType: "import",
      action: "csv",
      changes: [
        { field: "importedInvoices", from: null, to: 2 },
        { field: "importedContacts", from: null, to: 1 },
        { field: "skippedRows", from: null, to: 1 },
      ],
    });
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

describe("InvoiceImportService.importFromBitfaktura – business details", () => {
  const pdf = () => new Response("%PDF-1.4 x", { status: 200 });

  it("previews which empty fields the seller profile fills, without writing them", async () => {
    const { result, updated } = await run(pdf, true);
    expect(result.businessFilled).toEqual(["ico", "dic", "registryNote", "addressStreet", "addressCity", "addressPostalCode", "addressCountry"]);
    expect(updated).toEqual([]);
  });

  it("fills them on the real import", async () => {
    const { updated } = await run(pdf);
    expect(updated).toEqual([
      expect.objectContaining({
        table: schema.tenants,
        ico: "12345678",
        dic: "CZ8001011234",
        registryNote: "Fyzická osoba zapsaná v živnostenském rejstříku.",
        addressStreet: "Dlouhá 1",
        addressCity: "Praha",
        addressPostalCode: "110 00",
      }),
    ]);
  });

  it("writes nothing when the details are already filled in", async () => {
    const full = { ico: "87654321", dic: "CZ87654321", registryNote: "x", addressStreet: "Krátká 2", addressCity: "Brno", addressPostalCode: "602 00", addressCountry: "CZ" };
    const { result, updated } = await run(pdf, false, full);
    expect(result.businessFilled).toEqual([]);
    expect(updated).toEqual([]);
  });
});

describe("businessFill", () => {
  const from = { ico: "12345678", dic: "CZ8001011234", registryNote: "r", addressStreet: "Dlouhá 1", addressCity: "Praha", addressPostalCode: "11000", addressCountry: "CZ" };

  it("never overwrites a filled field", () => {
    expect(businessFill({ ...EMPTY_TENANT, ico: "87654321", dic: "CZ1", registryNote: "mine" }, from)).toEqual({
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressPostalCode: "11000",
      addressCountry: "CZ",
    });
  });

  it("fills the address only as a whole", () => {
    for (const partial of [{ addressStreet: "Krátká 2" }, { addressCity: "Brno" }, { addressPostalCode: "60200" }]) {
      expect(businessFill({ ...EMPTY_TENANT, ...partial }, from), JSON.stringify(partial)).not.toHaveProperty("addressStreet");
    }
  });

  it("does nothing without a seller profile", () => {
    expect(businessFill(EMPTY_TENANT, null)).toEqual({});
  });
});

/** A db whose every chain resolves: selects to [], inserts to one new row; invoice inserts are recorded. */
function recordingDb() {
  const invoices: Record<string, unknown>[] = [];
  const chain = (result: unknown, onValues?: (v: Record<string, unknown>) => void): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === "then") return (ok: (v: unknown) => void) => ok(result);
        return (arg: Record<string, unknown>) => {
          if (prop === "values") onValues?.(arg);
          return chain(result, onValues);
        };
      },
      apply: () => chain(result, onValues),
    });
  const db = {
    select: () => chain([]),
    update: () => chain([]),
    execute: () => chain([]),
    insert: (table: unknown) => chain([{ id: "new-id" }], (v) => void (table === schema.invoices && invoices.push(v))),
  };
  return { db, invoices };
}

describe("InvoiceImportService – party snapshots of imported invoices", () => {
  it("stores the buyer from the filled CSV columns and no supplier snapshot", async () => {
    const { db, invoices } = recordingDb();
    const csv = "Číslo;Odběratel;IČO;Ulice;Město;Datum vystavení;Celkem\nA1;Alfa s.r.o.;12345678;info@alfa.cz;Praha;1.1.2025;100\n";
    await new InvoiceImportService().importCsv(db as never, "tenant-1", Buffer.from(csv), false);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.sellerSnapshot).toBeNull();
    expect(invoices[0]!.buyerSnapshot).toMatchObject({ legalName: "Alfa s.r.o.", ico: "12345678", addressStreet: "info@alfa.cz", addressCity: "Praha", source: "import" });
  });

  it("stores the snapshots the BitFaktura mapping produced", async () => {
    const { db, invoices } = recordingDb();
    const mapped = {
      line: 1,
      invoiceNumber: "1/2025",
      variableSymbol: null,
      issueDate: new Date("2025-01-01"),
      dueDate: null,
      taxableSupplyDate: null,
      currency: "CZK",
      status: "issued",
      documentType: "invoice",
      note: null,
      amountPaid: 0,
      paidAt: null,
      customer: { legalName: "Beta", ico: null, dic: null, email: null, addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ" },
      lines: [{ description: "x", quantity: 1, unit: null, unitPrice: 100, vatRate: 0 }],
      sellerSnapshot: { legalName: "Stará Firma", source: "import" },
      buyerSnapshot: { legalName: "Beta – jak na dokladu", source: "import" },
    } as unknown as ImportedInvoice;
    const service = new InvoiceImportService() as unknown as { importMapped: (...a: unknown[]) => Promise<unknown> };
    await service.importMapped(db, "tenant-1", { invoices: [mapped], skipped: [] }, false);
    expect(invoices[0]!.sellerSnapshot).toEqual({ legalName: "Stará Firma", source: "import" });
    expect(invoices[0]!.buyerSnapshot).toEqual({ legalName: "Beta – jak na dokladu", source: "import" });
  });
});

describe("csvBuyerSnapshot", () => {
  it("keeps the filled columns only, and no country without an address", () => {
    const customer = { legalName: "Alfa", ico: null, dic: "", email: "a@b.cz", addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ" };
    const s = csvBuyerSnapshot(customer as never);
    expect(s).toMatchObject({ legalName: "Alfa", email: "a@b.cz" });
    expect(s).not.toHaveProperty("ico");
    expect(s).not.toHaveProperty("addressCountry");
  });
});
