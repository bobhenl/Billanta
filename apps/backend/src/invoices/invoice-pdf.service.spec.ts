import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { computeVatBreakdown } from "./invoice-total.util";
import { bilingualLabels, InvoicePdfService, mentionsReverseCharge, displayPostalCode } from "./invoice-pdf.service";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

function makeInvoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "inv-1",
    tenantId: "tenant-1",
    contactId: "contact-1",
    invoiceNumber: "2026-0001",
    variableSymbol: "20260001",
    issueDate: new Date("2026-09-09"),
    dueDate: new Date("2026-09-23"),
    currency: "CZK",
    status: "issued",
    source: "manual",
    aiConfidenceScore: null,
    issuedByUserId: "user-1",
    issuedAt: new Date("2026-09-09"),
    aiDraftReviewedAt: null,
    needsAttention: false,
    rawAiPayload: null,
    publicToken: "22222222-2222-2222-2222-222222222222",
    sentAt: null,
    lastReminderSentAt: null,
    reminderCount: 0,
    documentType: "invoice",
    relatedInvoiceId: null,
    taxableSupplyDate: null,
    paymentMethod: "bank_transfer",
    constantSymbol: null,
    specificSymbol: null,
    orderNumber: null,
    noteAbove: null,
    noteBelow: null,
    internalNote: null,
    language: "cs",
    reverseCharge: false,
    paidAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-09"),
    ...overrides,
  } as InvoiceRow;
}

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: "tenant-1",
    companyName: "Moje Firma",
    legalName: "Moje Firma s.r.o.",
    ico: "12345678",
    dic: "CZ12345678",
    dicVatPayer: true,
    addressStreet: "Hlavní 1",
    addressCity: "Praha",
    addressPostalCode: "11000",
    addressCountry: "CZ",
    bankAccountNumber: "123456",
    bankAccountBankCode: "0300",
    bankAccountIban: "CZ6508000000192000145399",
    defaultLocale: "cs",
    subscriptionPlanId: null,
    subscriptionStatus: "active",
    stripeCustomerId: null,
    gopayPayerId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as TenantRow;
}

function makeContact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "contact-1",
    tenantId: "tenant-1",
    ico: "87654321",
    dic: null,
    legalName: "ACME s.r.o.",
    email: "client@example.com",
    addressStreet: "Vedlejší 2",
    addressCity: "Brno",
    addressPostalCode: "60200",
    addressCountry: "CZ",
    aresVerifiedAt: null,
    isVatPayer: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as ContactRow;
}

function makeLineItems(): LineItemRow[] {
  return [
    {
      id: "li-1",
      tenantId: "tenant-1",
      invoiceId: "inv-1",
      description: "Konzultace",
      quantity: "3",
      unitPrice: "500",
      vatRate: "21",
      sortOrder: 0,
      createdAt: new Date("2026-09-01"),
    },
  ] as LineItemRow[];
}

describe("InvoicePdfService.generate", () => {
  const service = new InvoicePdfService();

  it("produces a non-empty, valid PDF buffer", async () => {
    const invoice = makeInvoice();
    const tenant = makeTenant();
    const contact = makeContact();
    const lineItems = makeLineItems();
    const totals = computeVatBreakdown(lineItems);

    const pdf = await service.generate(invoice, contact, tenant, lineItems, totals);

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.length).toBeGreaterThan(0);
    // pdfkit output is a real PDF file — every valid PDF starts with the
    // "%PDF-" magic bytes/header per the PDF spec.
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // ...and ends with the standard PDF trailer marker.
    expect(pdf.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
  });

  it("renders optional header fields and item codes", async () => {
    const invoice = makeInvoice({
      issuePlace: "Brno",
      issuedByName: "Jana Nováková",
      customFields: [{ label: "Číslo smlouvy", value: "SML-2026-07" }],
    });
    const lineItems = makeLineItems().map((li) => ({ ...li, code: "EAN-123" }));
    const pdf = await service.generate(invoice, makeContact(), makeTenant(), lineItems, computeVatBreakdown(lineItems));

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("embeds QR Platba + Faktura with an IBAN on file, a standalone QR Faktura without one", async () => {
    const lineItems = makeLineItems();
    const qr = vi.spyOn(QRCode, "toBuffer");
    const totals = computeVatBreakdown(lineItems);

    const withIban = await service.generate(
      makeInvoice(),
      makeContact(),
      makeTenant({ bankAccountIban: "CZ6508000000192000145399" }),
      lineItems,
      totals,
    );
    const withoutIban = await service.generate(
      makeInvoice(),
      makeContact(),
      makeTenant({ bankAccountIban: null, bankAccountNumber: null }),
      lineItems,
      totals,
    );

    expect(withIban.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(withoutIban.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const payloads = qr.mock.calls.map((c) => String(c[0]));
    expect(payloads[0]).toMatch(/^SPD\*1\.0\*ACC:CZ6508000000192000145399\*.*\*X-INV:SID%2A1\.0%2AID:/);
    expect(payloads[1]).toMatch(/^SID\*1\.0\*ID:/);
    qr.mockRestore();
  });

  it("embeds the company logo, and skips a broken one without failing", async () => {
    const lineItems = makeLineItems();
    const totals = computeVatBreakdown(lineItems);
    // 1×1 PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const withLogo = await service.generate(makeInvoice(), makeContact(), makeTenant({ logoData: png, logoMime: "image/png" }), lineItems, totals);
    const without = await service.generate(makeInvoice(), makeContact(), makeTenant({ logoData: null }), lineItems, totals);
    expect(withLogo.length).toBeGreaterThan(without.length);
    const broken = await service.generate(makeInvoice(), makeContact(), makeTenant({ logoData: "bm90IGFuIGltYWdl" }), lineItems, totals);
    expect(broken.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders an unissued draft as a stamped preview without a payment QR code", async () => {
    const lineItems = makeLineItems();
    const totals = computeVatBreakdown(lineItems);
    const qr = vi.spyOn(QRCode, "toBuffer");
    const text = vi.spyOn(PDFDocument.prototype, "text");

    const pdf = await service.generate(makeInvoice({ invoiceNumber: null, status: "draft" }), makeContact(), makeTenant({ bankAccountIban: "CZ6508000000192000145399" }), lineItems, totals);

    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(qr).not.toHaveBeenCalled();
    const written = text.mock.calls.map((c) => String(c[0]));
    expect(written).toContain("NÁHLED – nevystaveno");
    expect(written.some((w) => w.includes("(koncept)"))).toBe(true);
    qr.mockRestore();
    text.mockRestore();
  });
});

describe("bilingualLabels", () => {
  it("joins differing labels, keeps identical ones single, and recurses into nested groups", () => {
    const cs = { issueDate: "Datum vystavení", vat: "DPH", methods: { cash: "Hotově" } };
    const en = { issueDate: "Issue date", vat: "DPH", methods: { cash: "Cash" } };
    const out = bilingualLabels(cs as never, en as never) as unknown as typeof cs;
    expect(out).toEqual({ issueDate: "Datum vystavení / Issue date", vat: "DPH", methods: { cash: "Hotově / Cash" } });
  });

  it("renders a bilingual PDF when the tenant has a second language set", async () => {
    const lineItems = makeLineItems();
    const pdf = await new InvoicePdfService().generate(
      makeInvoice(),
      makeContact(),
      makeTenant({ invoiceFormPrefs: { pdfSecondLanguage: "en" } } as Partial<TenantRow>),
      lineItems,
      computeVatBreakdown(lineItems),
    );
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    if (process.env.PDF_SAMPLE_OUT) require("node:fs").writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);
  });
});

describe("InvoicePdfService exchange rate line", () => {
  /** Every string the renderer wrote, for a EUR document with these rate fields. */
  async function printed(over: Partial<InvoiceRow>) {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const lineItems = makeLineItems();
    await new InvoicePdfService().generate(
      makeInvoice({ currency: "EUR", exchangeRate: "25.120000", taxableSupplyDate: new Date("2026-03-14T10:00:00Z"), ...over }),
      makeContact(),
      makeTenant(),
      lineItems,
      computeVatBreakdown(lineItems),
    );
    const out = text.mock.calls.map((c) => String(c[0]));
    text.mockRestore();
    return out;
  }

  it("names the ČNB list day for a daily rate", async () => {
    expect(await printed({ exchangeRateMode: "cnb_daily", exchangeRateDate: "2026-03-13" })).toContain("Kurz ČNB k 13.03.2026 25,12 CZK/EUR");
  });
  it("names the year for an annual rate", async () => {
    expect(await printed({ exchangeRateMode: "annual", exchangeRateDate: "2026-01-01", exchangeRate: "24.600000" })).toContain(
      "Jednotný kurz pro rok 2026 24,6 CZK/EUR",
    );
  });
  it("prints no conversion when hidden", async () => {
    const out = await printed({ exchangeRateMode: "none" });
    expect(out.some((s) => s.includes("CZK/EUR") || s.startsWith("Celkem v CZK"))).toBe(false);
  });
  it("keeps the old line for documents issued before the setting", async () => {
    expect(await printed({ exchangeRateMode: null, exchangeRateDate: null })).toContain("Kurz ČNB 25,12 CZK/EUR");
  });
});

describe("InvoicePdfService buyer contact person", () => {
  async function printed(invoice: InvoiceRow, contact: ContactRow = makeContact()) {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const lineItems = makeLineItems();
    await new InvoicePdfService().generate(invoice, contact, makeTenant(), lineItems, computeVatBreakdown(lineItems));
    const out = text.mock.calls.map((c) => String(c[0]));
    text.mockRestore();
    return out;
  }

  it("prints the document's contact person in the buyer block, in the document language", async () => {
    expect(await printed(makeInvoice({ buyerContactPerson: "Jana Nováková" }))).toContain("Kontaktní osoba: Jana Nováková");
    expect(await printed(makeInvoice({ buyerContactPerson: "Ján Kováč", language: "sk" }))).toContain("Kontaktná osoba: Ján Kováč");
    expect(await printed(makeInvoice({ buyerContactPerson: "John Smith", language: "en" }))).toContain("Contact person: John Smith");
  });

  it("uses the document's value, not the contact's current one, and prints nothing when empty", async () => {
    const contact = makeContact({ contactPerson: "Někdo Jiný" });
    const out = await printed(makeInvoice({ buyerContactPerson: "Jana Nováková" }), contact);
    expect(out).toContain("Kontaktní osoba: Jana Nováková");
    expect(out.some((s) => s.includes("Někdo Jiný"))).toBe(false);
    expect((await printed(makeInvoice({ buyerContactPerson: null }), contact)).some((s) => s.startsWith("Kontaktní osoba"))).toBe(false);
  });
});

describe("mentionsReverseCharge", () => {
  it("spots the reverse-charge wording an imported note already carries", () => {
    expect(mentionsReverseCharge("584611057\r\nDaň odvede zákazník v režimu přenesené daňové povinnosti.")).toBe(true);
    expect(mentionsReverseCharge("Prenesenie daňovej povinnosti")).toBe(true);
    expect(mentionsReverseCharge("Reverse charge")).toBe(true);
    expect(mentionsReverseCharge("Děkujeme za objednávku.")).toBe(false);
    expect(mentionsReverseCharge(null)).toBe(false);
  });
});

describe("InvoicePdfService.generateLetter", () => {
  it("renders a reminder letter with Czech diacritics and CRLF input", async () => {
    const pdf = await new InvoicePdfService().generateLetter({
      language: "cs",
      title: "Výzva k úhradě",
      body: "Odesílatel: Jan Novák\r\nAdresát: Firma s.r.o.\r\n\r\nDobrý den,\r\n\r\nvyzýváme vás k úhradě faktury č. 2026-0042."
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
  });
});

describe("InvoicePdfService VAT columns", () => {
  async function lines(dicVatPayer: boolean, vatRate: string) {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const items = makeLineItems().map((item) => ({ ...item, vatRate }));
    await new InvoicePdfService().generate(makeInvoice(), makeContact(), makeTenant({ dicVatPayer }), items, computeVatBreakdown(items));
    const out = text.mock.calls.map((c) => String(c[0]));
    text.mockRestore();
    return out;
  }

  it("leaves the VAT column and summary off a non-VAT payer's invoice", async () => {
    const payer = await lines(true, "21");
    expect(payer).toContain("REKAPITULACE DPH");
    expect(payer).toContain("21%");
    const nonPayer = await lines(false, "0");
    expect(nonPayer).not.toContain("REKAPITULACE DPH");
    expect(nonPayer).not.toContain("0%");
    expect(nonPayer).not.toContain("DPH");
    // VAT charged by mistake is still shown, not hidden.
    expect(await lines(false, "21")).toContain("REKAPITULACE DPH");
  });

  it("bills a non-payer's whole jobs without quantity and unit price, unless a tax document needs them", async () => {
    async function headers(tenant: Partial<TenantRow>, quantity: string, contact: ContactRow = makeContact()) {
      const text = vi.spyOn(PDFDocument.prototype, "text");
      const items = makeLineItems().map((item) => ({ ...item, quantity, vatRate: "0" }));
      await new InvoicePdfService().generate(makeInvoice(), contact, makeTenant(tenant), items, computeVatBreakdown(items));
      const out = text.mock.calls.map((c) => String(c[0]));
      text.mockRestore();
      return out;
    }
    const lump = await headers({ dicVatPayer: false, vatStatus: "non_payer" } as Partial<TenantRow>, "1");
    expect(lump).not.toContain("Množství");
    expect(lump).not.toContain("Cena/j.");
    expect(await headers({ dicVatPayer: false, vatStatus: "non_payer" } as Partial<TenantRow>, "3")).toContain("Množství");
    expect(await headers({ dicVatPayer: true }, "1")).toContain("Množství");
    // An identified person's service to an EU business is a tax document.
    const euBuyer = makeContact({ addressCountry: "DE", dic: "DE123456789", ico: null } as Partial<ContactRow>);
    expect(await headers({ dicVatPayer: false, vatStatus: "identified" } as Partial<TenantRow>, "1", euBuyer)).toContain("Množství");
  });
});

describe("InvoicePdfService paid documents and foreign buyers", () => {
  async function render(invoice: InvoiceRow, contact: ContactRow = makeContact()) {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const qr = vi.spyOn(QRCode, "toBuffer");
    const lineItems = makeLineItems();
    const totals = computeVatBreakdown(lineItems);
    await new InvoicePdfService().generate(invoice, contact, makeTenant({ bankAccountIban: "CZ6508000000192000145399" }), lineItems, totals);
    const out = { lines: text.mock.calls.map((c) => String(c[0])), qr: qr.mock.calls.map((c) => String(c[0])), total: totals.totalWithVat };
    text.mockRestore();
    qr.mockRestore();
    return out;
  }

  it("asks a paid invoice for nothing: no payment QR, and zero left to pay", async () => {
    const paid = await render(makeInvoice({ status: "paid" }));
    expect(paid.qr.some((p) => p.startsWith("SPD*"))).toBe(false);
    expect(paid.qr.some((p) => p.startsWith("SID*"))).toBe(true);
    expect(paid.lines).toContain("Celkem");
    expect(paid.lines).not.toContain("Celkem k úhradě");
    expect(paid.lines).toContain("Zbývá uhradit");
    expect(paid.lines.some((l) => /^0,00\s/.test(l))).toBe(true);
  });

  it("keeps the payment QR for the rest after a partial payment", async () => {
    const partial = await render(makeInvoice({ amountPaid: "100.00" }));
    expect(partial.qr.find((p) => p.startsWith("SPD*"))).toMatch(new RegExp(`AM:${(partial.total - 100).toFixed(2)}\*`));
    expect(partial.lines).toContain("Zbývá uhradit");
    const unpaid = await render(makeInvoice());
    expect(unpaid.lines).toContain("Celkem k úhradě");
    expect(unpaid.lines).not.toContain("Zbývá uhradit");
  });

  it("prints the QR code the company chose in Settings → Faktury", async () => {
    async function qrFor(pdfQr: string, invoice: InvoiceRow = makeInvoice()) {
      const qr = vi.spyOn(QRCode, "toBuffer");
      const lineItems = makeLineItems();
      const tenant = makeTenant({ bankAccountIban: "CZ6508000000192000145399", invoiceFormPrefs: { pdfQr } } as Partial<TenantRow>);
      await new InvoicePdfService().generate(invoice, makeContact(), tenant, lineItems, computeVatBreakdown(lineItems));
      const out = qr.mock.calls.map((c) => String(c[0]));
      qr.mockRestore();
      return out;
    }
    expect((await qrFor("auto"))[0]).toMatch(/^SPD\*/);
    const link = await qrFor("link");
    expect(link).toHaveLength(1);
    expect(link[0]).toMatch(/\/cs\/i\/.*22222222-2222-2222-2222-222222222222/);
    // No public token, no page to link to.
    expect(await qrFor("link", makeInvoice({ publicToken: null } as unknown as Partial<InvoiceRow>))).toEqual([]);
    expect(await qrFor("off")).toEqual([]);
    // Both: the payment first, the page second; a paid one keeps QR Faktura next to the link.
    const both = await qrFor("auto_link");
    expect(both).toHaveLength(2);
    expect(both[0]).toMatch(/^SPD\*/);
    expect(both[1]).toMatch(/\/cs\/i\/.*22222222-2222-2222-2222-222222222222/);
    const paidBoth = await qrFor("auto_link", makeInvoice({ status: "paid" }));
    expect(paidBoth[0]).toMatch(/^SID\*/);
    expect(paidBoth[1]).toMatch(/\/cs\/i\//);
    expect(await qrFor("auto_link", makeInvoice({ invoiceNumber: null, status: "draft" }))).toEqual([]);
    // Nothing left to pay: "payment only" prints no QR Faktura instead.
    expect((await qrFor("payment_only"))[0]).toMatch(/^SPD\*/);
    expect(await qrFor("payment_only", makeInvoice({ status: "paid" }))).toEqual([]);
    expect((await qrFor("auto", makeInvoice({ status: "paid" })))[0]).toMatch(/^SID\*/);
  });

  it("leaves the due date out of the payment QR unless the company asks, so the bank offers to pay now", async () => {
    async function spayd(invoiceFormPrefs: Record<string, unknown>) {
      const qr = vi.spyOn(QRCode, "toBuffer");
      const lineItems = makeLineItems();
      const tenant = makeTenant({ bankAccountIban: "CZ6508000000192000145399", invoiceFormPrefs } as Partial<TenantRow>);
      await new InvoicePdfService().generate(makeInvoice(), makeContact(), tenant, lineItems, computeVatBreakdown(lineItems));
      const out = qr.mock.calls.map((c) => String(c[0])).find((p) => p.startsWith("SPD*")) ?? "";
      qr.mockRestore();
      return out;
    }
    expect(await spayd({ pdfQrDueDate: true })).toMatch(/\*DT:\d{8}\*/);
    const now = await spayd({});
    expect(now).toMatch(/^SPD\*/);
    // Banks read the date from the QR Faktura inside the payment code too.
    expect(now).toContain("X-INV:");
    expect(now).not.toMatch(/DT:/);
    // A QR Faktura on its own is for bookkeeping and keeps the due date.
    const qr = vi.spyOn(QRCode, "toBuffer");
    const lineItems = makeLineItems();
    const tenant = makeTenant({ bankAccountIban: "CZ6508000000192000145399", invoiceFormPrefs: {} } as Partial<TenantRow>);
    await new InvoicePdfService().generate(makeInvoice({ status: "paid" }), makeContact(), tenant, lineItems, computeVatBreakdown(lineItems));
    const sid = qr.mock.calls.map((c) => String(c[0])).find((p) => p.startsWith("SID*")) ?? "";
    qr.mockRestore();
    expect(sid).toMatch(/\*DT:\d{8}\*/);
  });

  it("prints IBAN only when the payer is abroad or pays in another currency", async () => {
    const home = await render(makeInvoice(), makeContact({ addressCountry: "CZ" }));
    expect(home.lines).toContain("123456/0300");
    expect(home.lines).not.toContain("IBAN");
    expect((await render(makeInvoice(), makeContact({ addressCountry: "DE" }))).lines).toContain("IBAN");
    expect((await render(makeInvoice({ currency: "EUR", exchangeRate: "25.000000" }), makeContact({ addressCountry: "CZ" }))).lines).toContain("IBAN");
  });

  it("keeps the QR code's place on a draft preview without a payable code", async () => {
    const draft = await render(makeInvoice({ invoiceNumber: null, status: "draft" }));
    expect(draft.qr).toEqual([]);
    expect(draft.lines).toContain("QR platba se doplní po vystavení");
    expect((await render(makeInvoice())).lines).not.toContain("QR platba se doplní po vystavení");
    const paid = await render(makeInvoice({ invoiceNumber: null, status: "pending_review", amountPaid: "1000000" }));
    expect(paid.lines).toContain("QR Faktura se doplní po vystavení");
    expect(paid.lines).not.toContain("QR platba se doplní po vystavení");
  });

  it("prints a Czech non-payer's own DIČ only for a buyer abroad", async () => {
    async function supplierLines(tenant: Partial<TenantRow>, contact: ContactRow = makeContact()) {
      const text = vi.spyOn(PDFDocument.prototype, "text");
      const items = makeLineItems().map((item) => ({ ...item, vatRate: "0" }));
      await new InvoicePdfService().generate(makeInvoice(), contact, makeTenant(tenant), items, computeVatBreakdown(items));
      const out = text.mock.calls.map((c) => String(c[0]));
      text.mockRestore();
      return out;
    }
    const identified = { dicVatPayer: false, vatStatus: "identified", dic: "CZ0202284379" } as Partial<TenantRow>;
    expect(await supplierLines(identified)).not.toContain("DIČ: CZ0202284379");
    expect(await supplierLines({ dicVatPayer: true, dic: "CZ0202284379" })).toContain("DIČ: CZ0202284379");
    const euBuyer = makeContact({ addressCountry: "DE", dic: "DE123456789", ico: null } as Partial<ContactRow>);
    expect(await supplierLines(identified, euBuyer)).toContain("DIČ: CZ0202284379");
    expect(await supplierLines(identified, makeContact({ addressCountry: "US", dic: null, ico: null } as Partial<ContactRow>))).toContain("DIČ: CZ0202284379");
    const slovak = { dicVatPayer: false, vatStatus: "non_payer", dic: "2020123456", country: "SK" } as Partial<TenantRow>;
    expect(await supplierLines(slovak, makeContact({ addressCountry: "SK" } as Partial<ContactRow>))).toContain("DIČ: 2020123456");

    // DUZP only on a tax document: an identified person's EU reverse charge, not a domestic invoice.
    expect(await supplierLines(identified)).not.toContain("DUZP");
    expect(await supplierLines(identified, euBuyer)).toContain("DUZP");
    expect(await supplierLines({ dicVatPayer: true })).toContain("DUZP");

    // The register entry sits with the seller, above the items.
    const note = "Fyzická osoba zapsaná v živnostenském rejstříku.";
    const lines = await supplierLines({ ...identified, registryNote: note } as Partial<TenantRow>);
    expect(lines.indexOf(note)).toBeGreaterThan(-1);
    expect(lines.indexOf(note)).toBeLessThan(lines.indexOf("Popis"));
    expect(lines.filter((l) => l === note)).toHaveLength(1);
  });

  it("prints a Czech or Slovak PSČ with the space, whatever the register gave", async () => {
    expect((await render(makeInvoice(), makeContact({ addressPostalCode: "60200", addressCity: "Brno", addressCountry: "CZ" }))).lines).toContain("602 00 Brno");
    expect(displayPostalCode("81101", "SK")).toBe("811 01");
    expect(displayPostalCode("602 00", "CZ")).toBe("602 00");
    expect(displayPostalCode("10115", "DE")).toBe("10115");
    expect(displayPostalCode("SW1A 1AA", "GB")).toBe("SW1A 1AA");
  });

  it("prints the country of a buyer abroad, not of a domestic one", async () => {
    expect((await render(makeInvoice(), makeContact({ addressCountry: "US" }))).lines).toContain("Spojené státy");
    expect((await render(makeInvoice({ language: "en" }), makeContact({ addressCountry: "US" }))).lines).toContain("United States");
    expect((await render(makeInvoice(), makeContact({ addressCountry: "CZ" }))).lines.some((l) => l === "Česko")).toBe(false);
  });

  it("prints the seller's country next to a foreign buyer's, in the document language", async () => {
    const abroad = await render(makeInvoice({ language: "en" }), makeContact({ addressCountry: "DE" }));
    expect(abroad.lines).toContain("Germany");
    expect(abroad.lines).toContain("Czechia");
    expect((await render(makeInvoice({ language: "en" }), makeContact({ addressCountry: "CZ" }))).lines).not.toContain("Czechia");
  });

  it("asks a cancelled invoice for nothing: no payment QR and no \"Celkem k úhradě\"", async () => {
    const cancelled = await render(makeInvoice({ status: "cancelled" }));
    expect(cancelled.qr.some((p) => p.startsWith("SPD*"))).toBe(false);
    expect(cancelled.lines).not.toContain("Celkem k úhradě");
    expect(cancelled.lines).toContain("Celkem");
  });
});

describe("InvoicePdfService credit note", () => {
  it("labels the negative total \"Celkem\", not as something to pay", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const lineItems = makeLineItems().map((li) => ({ ...li, quantity: `-${li.quantity}` }));
    const totals = computeVatBreakdown(lineItems);
    expect(totals.totalWithVat).toBeLessThan(0);
    await new InvoicePdfService().generate(makeInvoice({ documentType: "credit_note" }), makeContact(), makeTenant(), lineItems, totals);
    const lines = text.mock.calls.map((c) => String(c[0]));
    text.mockRestore();
    expect(lines).not.toContain("Celkem k úhradě");
    expect(lines).toContain("Celkem");
  });
});
