import { describe, expect, it } from "vitest";
import { guestInvoiceSchema, type GuestInvoiceInput } from "../guest-invoices/guest-invoices.service";
import { guestBusinessFill, mapGuestInvoices, newestSupplier } from "./guest-import";

const NOW = new Date("2026-10-21T10:00:00Z");

const guest = (over: Record<string, unknown> = {}): GuestInvoiceInput =>
  guestInvoiceSchema.parse({
    invoiceNumber: "20260001",
    issueDate: "2026-10-01",
    dueDate: "2026-10-15",
    supplier: { name: "Jan Novák", street: "Dlouhá 1", city: "Praha", postalCode: "110 00", ico: "12345678", bankAccountNumber: "123456789", bankCode: "0100" },
    customer: { name: "Odběratel s.r.o.", ico: "87654321", dic: "CZ87654321", city: "Brno" },
    items: [{ description: "Konzultace", quantity: 2, unitPrice: 1000, vatRate: 21 }],
    ...over,
  });

const EMPTY_TENANT = {
  ico: null,
  dic: null,
  addressStreet: null,
  addressCity: null,
  addressPostalCode: null,
  email: null,
  phone: null,
  bankAccountNumber: null,
  bankAccountBankCode: null,
  bankAccountIban: null,
};

describe("mapGuestInvoices", () => {
  it("maps a guest invoice to issued history with both party snapshots", () => {
    const { invoices, skipped } = mapGuestInvoices([guest()], "CZ", NOW);
    expect(skipped).toEqual([]);
    const inv = invoices[0]!;
    expect(inv).toMatchObject({
      invoiceNumber: "20260001",
      documentType: "invoice",
      status: "issued",
      amountPaid: 0,
      paidAt: null,
      variableSymbol: "20260001",
      taxableSupplyDate: null,
      currency: "CZK",
      paymentMethod: "bank_transfer",
      reverseCharge: false,
    });
    expect(inv.customer).toMatchObject({ legalName: "Odběratel s.r.o.", ico: "87654321", dic: "CZ87654321", addressCity: "Brno", addressCountry: "CZ" });
    expect(inv.sellerSnapshot).toMatchObject({ legalName: "Jan Novák", ico: "12345678", dicVatPayer: false, bankAccountNumber: "123456789", bankAccountBankCode: "0100", source: "import" });
    expect(inv.buyerSnapshot).toMatchObject({ legalName: "Odběratel s.r.o.", ico: "87654321", capturedAt: NOW.toISOString() });
  });

  it("counts a non-payer's VAT as 0 and allows reverse charge only to a VAT payer", () => {
    const [nonPayer] = mapGuestInvoices([guest({ reverseCharge: true })], "CZ", NOW).invoices;
    expect(nonPayer!.lines[0]!.vatRate).toBe(0);
    expect(nonPayer!.reverseCharge).toBe(false);

    const [payer] = mapGuestInvoices([guest({ vatPayer: true, reverseCharge: true })], "CZ", NOW).invoices;
    expect(payer!.lines[0]!.vatRate).toBe(21);
    expect(payer!.reverseCharge).toBe(true);
    expect(payer!.taxableSupplyDate?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("keeps only the last copy of a number downloaded twice", () => {
    const first = guest({ note: "první" });
    const fixed = guest({ note: "opravená" });
    const other = guest({ invoiceNumber: "20260002" });
    const { invoices, skipped } = mapGuestInvoices([first, other, fixed], "CZ", NOW);
    expect(invoices.map((i) => [i.invoiceNumber, i.note])).toEqual([
      ["20260002", null],
      ["20260001", "opravená"],
    ]);
    expect(skipped).toEqual([{ line: 1, number: "20260001", reason: "duplicate_in_file" }]);
  });

  it("reads the customer's country from a Slovak DIČ, else uses the company's own", () => {
    const sk = mapGuestInvoices([guest({ customer: { name: "Firma", dic: "SK2020123456" } })], "CZ", NOW).invoices[0]!;
    expect(sk.customer.addressCountry).toBe("SK");
    const plain = mapGuestInvoices([guest({ customer: { name: "Firma" } })], "SK", NOW).invoices[0]!;
    expect(plain.customer.addressCountry).toBe("SK");
  });

  it("notes the corrected invoice of a credit note internally", () => {
    const [note] = mapGuestInvoices([guest({ invoiceNumber: "OD20260001", documentType: "credit_note", relatedInvoiceNumber: "20260001" })], "CZ", NOW).invoices;
    expect(note!.documentType).toBe("credit_note");
    expect(note!.internalNote).toBe("K dokladu 20260001");
  });
});

describe("guestBusinessFill", () => {
  it("fills empty company details from the supplier block", () => {
    expect(guestBusinessFill(EMPTY_TENANT, guest({ supplier: { name: "Jan", street: "Dlouhá 1", city: "Praha", postalCode: "110 00", ico: "12345678", dic: "cz 12345678", email: "jan@example.com", iban: "CZ65 0800 0000 1920 0014 5399" } }).supplier)).toEqual({
      ico: "12345678",
      dic: "CZ12345678",
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressPostalCode: "110 00",
      email: "jan@example.com",
      bankAccountIban: "CZ6508000000192000145399",
    });
  });

  it("never overwrites what the company already has and fills the address only as a whole", () => {
    const current = { ...EMPTY_TENANT, ico: "11111111", addressCity: "Ostrava", bankAccountIban: "CZ6508000000192000145399" };
    expect(guestBusinessFill(current, guest().supplier)).toEqual({});
  });

  it("takes a Czech account number only with its bank code", () => {
    const fill = guestBusinessFill(EMPTY_TENANT, guest({ supplier: { name: "Jan", bankAccountNumber: "123456789" } }).supplier);
    expect(fill.bankAccountNumber).toBeUndefined();
  });

  it("ignores a malformed IČO or DIČ", () => {
    const fill = guestBusinessFill(EMPTY_TENANT, guest({ supplier: { name: "Jan", ico: "abc", dic: "123" } }).supplier);
    expect(fill).toEqual({});
  });
});

describe("newestSupplier", () => {
  it("picks the supplier block of the latest issue date", () => {
    const older = guest({ issueDate: "2026-09-01", supplier: { name: "Starý" } });
    const newer = guest({ issueDate: "2026-10-01", supplier: { name: "Nový" } });
    expect(newestSupplier([newer, older])?.name).toBe("Nový");
    expect(newestSupplier([])).toBeUndefined();
  });
});
