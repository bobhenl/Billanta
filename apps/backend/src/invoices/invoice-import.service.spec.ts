import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { businessFill, csvBuyerSnapshot, distinctSellers, importedRate, InvoiceImportService, sellerProfileUpdate } from "./invoice-import.service";
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
  sellerIco?: string,
) {
  const service = new InvoiceImportService(audit as never);
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  let contacts: unknown;
  let mappedSeen: { invoices: ImportedInvoice[]; skipped: unknown[] } | undefined;
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
    mappedSeen = mapped as never;
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
    // Invoice 13 was issued by another business sharing the account.
    invoices: (src as { id: number; number: string }[]).map(
      (s) =>
        ({
          line: s.id,
          invoiceNumber: s.number,
          sourceId: s.id,
          issueDate: new Date(Date.UTC(2026, 9, s.id)),
          sellerSnapshot: { ico: s.id === 13 ? "87654321" : "12345678", legalName: s.id === 13 ? "Jiná firma" : "Jan Novák" },
        }) as ImportedInvoice,
    ),
    skipped: [],
  }));
  const result = await service.importFromBitfaktura(db as never, "tenant-1", "firma", "t0ken-xyz", dryRun, fetcher as never, sellerIco);
  return { result, inserted, contacts, updated, mapped: mappedSeen };
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
  const contacts: Record<string, unknown>[] = [];
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
    insert: (table: unknown) =>
      chain([{ id: "new-id" }], (v) => {
        if (table === schema.invoices) invoices.push(v);
        if (table === schema.contacts) contacts.push(v);
      }),
  };
  return { db, invoices, contacts };
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

  it("passes the CSV document details through to the invoice and the new contact", async () => {
    const { db, invoices, contacts } = recordingDb();
    const csv =
      "Číslo;Odběratel;Datum vystavení;Celkem;PDP;Kód předmětu plnění;KS;Způsob úhrady;Číslo objednávky;Interní poznámka;Místo vystavení;Vystavil;Telefon;Kontaktní osoba\n" +
      "A1;Alfa s.r.o.;1.1.2025;100;ano;4;308;Hotově;OBJ-1;interní;Brno;Jana;777 000 111;Petr\n";
    await new InvoiceImportService().importCsv(db as never, "tenant-1", Buffer.from(csv), false);
    expect(invoices[0]).toMatchObject({
      reverseCharge: true,
      reverseChargeCode: "4",
      constantSymbol: "0308",
      paymentMethod: "cash",
      paymentMethodLabel: null,
      orderNumber: "OBJ-1",
      internalNote: "interní",
      issuePlace: "Brno",
      issuedByName: "Jana",
    });
    expect(contacts[0]).toMatchObject({ legalName: "Alfa s.r.o.", phone: "777 000 111", internalNote: "Kontaktní osoba: Petr" });
    // Phone and contact person describe the contact, not what the document printed.
    expect(invoices[0]!.buyerSnapshot).not.toHaveProperty("phone");
    expect(invoices[0]!.buyerSnapshot).not.toHaveProperty("internalNote");
  });

  it("never stores a KH code without reverse charge", async () => {
    const { db, invoices } = recordingDb();
    const mapped = {
      line: 1,
      invoiceNumber: "X1",
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
      lines: [{ description: "x", quantity: 1, unit: null, unitPrice: 100, vatRate: 21 }],
      reverseChargeCode: "4",
    } as unknown as ImportedInvoice;
    const service = new InvoiceImportService() as unknown as { importMapped: (...a: unknown[]) => Promise<unknown> };
    await service.importMapped(db, "tenant-1", { invoices: [mapped], skipped: [] }, false);
    expect(invoices[0]).toMatchObject({ reverseCharge: false, reverseChargeCode: null, constantSymbol: null });
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

describe("InvoiceImportService.importFromBitfaktura – several suppliers", () => {
  const pdf = () => new Response("%PDF-1.4", { status: 200 });

  it("lists the supplier IČOs on the preview and imports everything when none is chosen", async () => {
    const { result, mapped } = await run(pdf, true);
    expect(result.sellers).toEqual([
      { ico: "12345678", name: "Jan Novák", invoices: 2 },
      { ico: "87654321", name: "Jiná firma", invoices: 1 },
    ]);
    expect(mapped!.invoices).toHaveLength(3);
  });

  it("imports only the chosen supplier's invoices and reports the rest as skipped", async () => {
    const { result, mapped } = await run(pdf, false, EMPTY_TENANT, undefined, "87654321");
    expect(mapped!.invoices.map((i) => i.invoiceNumber)).toEqual(["3/10/2026"]);
    expect(mapped!.skipped).toEqual([
      { line: 11, number: "1/10/2026", reason: "other_seller" },
      { line: 12, number: "2/10/2026", reason: "other_seller" },
    ]);
    // Still listed, so the choice can be changed.
    expect(result.sellers).toHaveLength(2);
  });

  it("suggests the newest imported invoice's supplier details after a real run only", async () => {
    const profile = { ...EMPTY_TENANT, ico: "87654321", companyName: "Jiná", legalName: "Jiná" };
    expect((await run(pdf, true, profile, undefined, "87654321")).result.sellerUpdate).toBeUndefined();
    const { result } = await run(pdf, false, profile, undefined, "87654321");
    expect(result.sellerUpdate).toMatchObject({ invoiceNumber: "3/10/2026", changes: [{ field: "name", from: "Jiná", to: "Jiná firma" }] });
  });
});

describe("distinctSellers", () => {
  const inv = (ico: string | undefined) => ({ sellerSnapshot: ico ? { ico, legalName: `F ${ico}` } : null }) as ImportedInvoice;

  it("is empty with one supplier, or none known", () => {
    expect(distinctSellers([inv("12345678"), inv("12345678"), inv(undefined)])).toEqual([]);
    expect(distinctSellers([])).toEqual([]);
  });
});

describe("sellerProfileUpdate", () => {
  const profile = {
    ico: "12345678",
    companyName: "Lesní Studio",
    legalName: "Lesní Studio",
    dic: "CZ12345678",
    addressStreet: "Stará 4",
    addressCity: "Brno",
    addressPostalCode: "602 00",
    addressCountry: "CZ",
  };
  const newest = (seller: Record<string, unknown>) =>
    ({ invoiceNumber: "9/2026", issueDate: new Date("2026-09-30T00:00:00Z"), sellerSnapshot: { ico: "12345678", ...seller } }) as ImportedInvoice;

  it("suggests the newest invoice's address, name and DIČ where they differ", () => {
    const update = sellerProfileUpdate(
      profile,
      newest({ legalName: "Lesní Studio s.r.o.", dic: "CZ12345678", addressStreet: "Nová 9", addressCity: "Olomouc", addressPostalCode: "779 00", addressCountry: "CZ" }),
    );
    expect(update).toEqual({
      invoiceNumber: "9/2026",
      issueDate: "2026-09-30",
      changes: [
        { field: "name", from: "Lesní Studio", to: "Lesní Studio s.r.o." },
        { field: "address", from: "Stará 4, 602 00, Brno", to: "Nová 9, 779 00, Olomouc" },
      ],
      patch: {
        legal_name: "Lesní Studio s.r.o.",
        company_name: "Lesní Studio s.r.o.",
        address_street: "Nová 9",
        address_city: "Olomouc",
        address_postal_code: "779 00",
        address_country: "CZ",
      },
    });
  });

  it("stays quiet when the details agree, or the invoice is another company's", () => {
    const sameDetails = { legalName: "lesní studio", dic: "CZ12345678", addressStreet: "Stará 4", addressCity: "Brno", addressPostalCode: "602 00", addressCountry: "CZ" };
    expect(sellerProfileUpdate(profile, newest(sameDetails))).toBeNull();
    expect(sellerProfileUpdate(profile, newest({ ...sameDetails, ico: "87654321", addressStreet: "Jinde 1" }))).toBeNull();
    expect(sellerProfileUpdate(profile, undefined)).toBeNull();
  });

  it("offers a new DIČ, never a half address or an e-mail typed into the street", () => {
    expect(sellerProfileUpdate(profile, newest({ dic: "CZ8001011234", addressStreet: "info@lesni.example", addressCity: "Brno" }))?.changes).toEqual([
      { field: "dic", from: "CZ12345678", to: "CZ8001011234" },
    ]);
    expect(sellerProfileUpdate(profile, newest({ addressStreet: "Nová 9", addressCity: null }))).toBeNull();
  });
});

describe("importedRate", () => {
  const doc = { currency: "EUR", exchangeRate: undefined, exchangeRateMode: undefined, exchangeRateDate: undefined, taxableSupplyDate: new Date("2025-03-09"), issueDate: new Date("2025-03-10") };
  // A Sunday DUZP: ČNB's list is Friday's, and that day is what gets stored.
  const cnb = vi.fn(async () => ({ date: "2025-03-07", rates: new Map([["EUR", { rate: 25.06, amount: 1 }]]) }) as never);

  it("stores a rate it looked up as a ČNB rate with the list day", async () => {
    expect(await importedRate(doc, cnb)).toEqual({ exchangeRate: "25.06", exchangeRateMode: "cnb_daily", exchangeRateDate: "2025-03-07" });
    expect(cnb).toHaveBeenCalledWith(doc.taxableSupplyDate);
  });

  it("keeps the source's own rate and its origin", async () => {
    expect(await importedRate({ ...doc, exchangeRate: 24.5, exchangeRateMode: "manual" }, cnb)).toEqual({ exchangeRate: "24.5", exchangeRateMode: "manual", exchangeRateDate: null });
    expect(await importedRate({ ...doc, exchangeRate: 24.5 }, cnb)).toEqual({ exchangeRate: "24.5" });
  });

  it("leaves the rate empty when ČNB has none and for koruna documents", async () => {
    expect(await importedRate({ ...doc, currency: "XYZ" }, cnb)).toEqual({ exchangeRate: null });
    expect(await importedRate({ ...doc, currency: "CZK" }, cnb)).toEqual({ exchangeRate: null });
  });
});
