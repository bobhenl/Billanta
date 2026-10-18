import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { computeVatBreakdown } from "./invoice-total.util";
import { bilingualLabels, InvoicePdfService, mentionsReverseCharge } from "./invoice-pdf.service";

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

  it("throws if the invoice has no invoiceNumber (never issued)", async () => {
    const lineItems = makeLineItems();
    const totals = computeVatBreakdown(lineItems);

    await expect(
      service.generate(makeInvoice({ invoiceNumber: null }), makeContact(), makeTenant(), lineItems, totals),
    ).rejects.toThrow(/invoiceNumber/);
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
