import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailService } from "../email/email.service";
import type { InvoicePdfService } from "./invoice-pdf.service";
import { InvoicesService } from "./invoices.service";

// The sending guard has its own spec; here it always allows the send.
vi.mock("../abuse/sending-guard", () => ({ assertCanSendEmail: vi.fn(async () => undefined), recordEmailSent: vi.fn(async () => undefined) }));

type MockEmailService = { sendInvoiceEmail: ReturnType<typeof vi.fn> };
type MockInvoicePdfService = { generate: ReturnType<typeof vi.fn> };

/**
 * Minimal fake of a Drizzle query-builder chain: supports the exact method
 * sequences `InvoicesService.sendInvoice` calls
 * (`.select().from().where().limit()` and `.select().from().where()` with
 * no `.limit()` for the line-items query) without pulling in a real
 * drizzle-orm query builder or a database. The chain object is itself
 * thenable so `await` works whether or not `.limit()` was called.
 */
function makeSelectChain<T>(result: T[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(result));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeUpdateChain<T>(result: T[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve(result));
  return chain;
}

function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    tenantId: "tenant-1",
    contactId: "contact-1",
    invoiceNumber: "2026-0001",
    variableSymbol: null,
    issueDate: new Date("2026-09-01"),
    dueDate: new Date("2026-09-15"),
    currency: "CZK",
    status: "issued",
    source: "manual",
    aiConfidenceScore: null,
    issuedByUserId: null,
    issuedAt: new Date("2026-09-01"),
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
    issuePlace: null,
    issuedByName: null,
    customFields: [],
    noteAbove: null,
    noteBelow: null,
    internalNote: null,
    language: "cs",
    reverseCharge: false,
    paidAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ...overrides,
  };
}

function makeContact(overrides: Record<string, unknown> = {}) {
  return {
    id: "contact-1",
    tenantId: "tenant-1",
    ico: null,
    dic: null,
    legalName: "ACME s.r.o.",
    email: "client@example.com",
    addressStreet: null,
    addressCity: null,
    addressPostalCode: null,
    addressCountry: "CZ",
    aresVerifiedAt: null,
    isVatPayer: null,
    isStarred: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

const lineItems = [
  {
    id: "li-1",
    tenantId: "tenant-1",
    invoiceId: "inv-1",
    description: "Consulting",
    quantity: "3",
    unitPrice: "500",
    vatRate: "21",
    sortOrder: 0,
    createdAt: new Date("2026-09-01"),
  },
];

describe("InvoicesService.sendInvoice", () => {
  let emailService: MockEmailService;
  let invoicePdfService: MockInvoicePdfService;
  let service: InvoicesService;

  beforeEach(() => {
    emailService = { sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) };
    invoicePdfService = { generate: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")) };
    service = new InvoicesService(
      emailService as unknown as EmailService,
      invoicePdfService as unknown as InvoicePdfService,
    );
  });

  it("happy path: emails the invoice's contact and stamps sent_at", async () => {
    const invoice = makeInvoice();
    const contact = makeContact();
    const updated = { ...invoice, sentAt: new Date("2026-09-09T09:00:00Z") };

    const select = vi
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain([contact]))
      .mockReturnValueOnce(makeSelectChain(lineItems));
    const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update } as any;

    const result = await service.sendInvoice(db, "inv-1");

    expect(emailService.sendInvoiceEmail).toHaveBeenCalledWith({
      corrected: false,
      to: "client@example.com",
      invoiceNumber: "2026-0001",
      amount: "1815.00 CZK", // 3 * 500 * 1.21
      dueDate: invoice.dueDate,
      publicToken: invoice.publicToken,
    });
    expect(update).toHaveBeenCalled();
    expect(result).toEqual(updated);
  });

  it("throws NotFoundException when the invoice doesn't exist (or isn't visible under RLS)", async () => {
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update: vi.fn() } as any;

    await expect(service.sendInvoice(db, "missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(emailService.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when the invoice has no contact at all", async () => {
    const invoice = makeInvoice({ contactId: null });
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update: vi.fn() } as any;

    await expect(service.sendInvoice(db, "inv-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(emailService.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when the contact has no email on file", async () => {
    const invoice = makeInvoice();
    const contact = makeContact({ email: null });
    const select = vi
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain([contact]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update: vi.fn() } as any;

    await expect(service.sendInvoice(db, "inv-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(emailService.sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("never marks sent_at if the email send itself throws", async () => {
    const invoice = makeInvoice();
    const contact = makeContact();
    const select = vi
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain([contact]))
      .mockReturnValueOnce(makeSelectChain(lineItems));
    const update = vi.fn();
    emailService.sendInvoiceEmail.mockRejectedValueOnce(new Error("Resend outage"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update } as any;

    await expect(service.sendInvoice(db, "inv-1")).rejects.toThrow("Resend outage");
    expect(update).not.toHaveBeenCalled();
  });
});

/** Minimal fake of `.insert().values().onConflictDoUpdate().returning()`, as `allocateNextInvoiceSequence` calls it. */
function makeSequenceInsertChain(lastNumber: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  chain.values = vi.fn(() => chain);
  chain.onConflictDoUpdate = vi.fn(() => chain);
  chain.returning = vi.fn(() => Promise.resolve([{ lastNumber }]));
  return chain;
}

describe("InvoicesService.issue", () => {
  let emailService: MockEmailService;
  let invoicePdfService: MockInvoicePdfService;
  let service: InvoicesService;

  beforeEach(() => {
    emailService = { sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) };
    invoicePdfService = { generate: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")) };
    service = new InvoicesService(
      emailService as unknown as EmailService,
      invoicePdfService as unknown as InvoicePdfService,
    );
  });

  const issuableInvoice = () =>
    makeInvoice({ status: "draft", invoiceNumber: null, issuedAt: null, issuedByUserId: null });

  it("happy path: allocates a sequential number and flips status -> issued", async () => {
    const invoice = issuableInvoice();
    const updated = { ...invoice, status: "issued", invoiceNumber: "2026-0001" };

    const select = vi
      .fn(() => makeSelectChain([])) // then: no tenant / contact row to snapshot
      .mockReturnValueOnce(makeSelectChain([invoice])) // load invoice
      .mockReturnValueOnce(makeSelectChain(lineItems)) // load line items
      .mockReturnValueOnce(makeSelectChain([{ numberFormats: null }])) // tenant's number formats
      .mockReturnValueOnce(makeSelectChain([])); // number not taken yet
    const insert = vi.fn().mockReturnValue(makeSequenceInsertChain(1));
    const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update } as any;

    const result = await service.issue(db, "tenant-1", "inv-1", "user-1");

    expect(result).toEqual(updated);
    expect(update).toHaveBeenCalled();
    const setArg = (update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(setArg).toMatchObject({
      invoiceNumber: "2026-0001",
      variableSymbol: "20260001",
      status: "issued",
      issuedByUserId: "user-1",
    });
    expect(setArg.issuedAt).toBeInstanceOf(Date);
  });

  it("numbers in the company's own pattern, per month, skipping a number that already exists", async () => {
    // Issue date 2026-09-01 → the September 2026 counter; 1/09/2026 was imported, so 2/09/2026.
    const invoice = issuableInvoice();
    const updated = { ...invoice, status: "issued", invoiceNumber: "2/09/2026" };
    const select = vi
      .fn(() => makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain(lineItems))
      .mockReturnValueOnce(makeSelectChain([{ numberFormats: { invoice: "{N}/{MM}/{YYYY}" } }]))
      .mockReturnValueOnce(makeSelectChain([{ id: "imported" }])) // 1/09/2026 taken
      .mockReturnValueOnce(makeSelectChain([])); // 2/09/2026 free
    let last = 0;
    const chains: ReturnType<typeof makeSequenceInsertChain>[] = [];
    const insert = vi.fn(() => {
      const chain = makeSequenceInsertChain(++last);
      chains.push(chain);
      return chain;
    });
    const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update } as any;

    await service.issue(db, "tenant-1", "inv-1", "user-1");

    expect(insert).toHaveBeenCalledTimes(2);
    expect(chains[0]!.values).toHaveBeenCalledWith({ tenantId: "tenant-1", series: "", year: 2026, month: 9, lastNumber: 1 });
    const setArg = (update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(setArg).toMatchObject({ invoiceNumber: "2/09/2026", variableSymbol: "2092026" });
  });

  it("rejects issuing an already-issued invoice (400), without touching the sequence or the row", async () => {
    const invoice = makeInvoice({ status: "issued" });
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    const insert = vi.fn();
    const update = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects issuing an already-paid invoice (400)", async () => {
    const invoice = makeInvoice({ status: "paid" });
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn(), update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects issuing a cancelled invoice (400)", async () => {
    const invoice = makeInvoice({ status: "cancelled" });
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn(), update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws NotFoundException when the invoice doesn't exist", async () => {
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn(), update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "missing", "user-1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects when the invoice has no contact assigned", async () => {
    const invoice = { ...issuableInvoice(), contactId: null };
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn(), update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects when the invoice has no due date set", async () => {
    const invoice = { ...issuableInvoice(), dueDate: null };
    const select = vi.fn().mockReturnValueOnce(makeSelectChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn(), update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects when the invoice has no line items", async () => {
    const invoice = issuableInvoice();
    const select = vi
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain([])); // no line items
    const insert = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update: vi.fn() } as any;

    await expect(service.issue(db, "tenant-1", "inv-1", "user-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it("sets aiDraftReviewedAt for an AI-sourced draft that hadn't been reviewed yet", async () => {
    const invoice = { ...issuableInvoice(), source: "ai_telegram" as const, aiDraftReviewedAt: null };
    const updated = { ...invoice, status: "issued", invoiceNumber: "2026-0001" };

    const select = vi
      .fn(() => makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain(lineItems))
      .mockReturnValueOnce(makeSelectChain([{ numberFormats: null }]))
      .mockReturnValueOnce(makeSelectChain([]));
    const insert = vi.fn().mockReturnValue(makeSequenceInsertChain(1));
    const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update } as any;

    await service.issue(db, "tenant-1", "inv-1", "user-1");

    const setArg = (update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(setArg.aiDraftReviewedAt).toBeInstanceOf(Date);
  });
});

const liveTenant = {
  id: "tenant-1",
  companyName: "Firma",
  legalName: "Firma s.r.o.",
  ico: "12345678",
  dic: "CZ12345678",
  dicVatPayer: true,
  addressStreet: "Nová 2",
  addressCity: "Brno",
  addressPostalCode: "602 00",
  addressCountry: "CZ",
  registryNote: null,
  email: "f@firma.cz",
  phone: null,
  website: null,
  bankAccountNumber: "1000",
  bankAccountBankCode: "0100",
  bankAccountIban: null,
  bankAccountSwift: null,
  numberFormats: null,
};

describe("InvoicesService – supplier and buyer as on the issue date", () => {
  let invoicePdfService: MockInvoicePdfService;
  let service: InvoicesService;

  beforeEach(() => {
    invoicePdfService = { generate: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")) };
    service = new InvoicesService({} as EmailService, invoicePdfService as unknown as InvoicePdfService);
  });

  it("issue() stores both parties, with the bank account the document is paid to", async () => {
    const invoice = makeInvoice({ status: "draft", invoiceNumber: null, issuedAt: null, bankAccountId: null });
    const contact = makeContact({ ico: "87654321", addressStreet: "Jiná 5" });
    const account = { id: "acc-1", tenantId: "tenant-1", currency: "CZK", accountNumber: "2000", bankCode: "0800", iban: null, swift: null, sortOrder: 0 };
    const select = vi
      .fn(() => makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain(lineItems))
      .mockReturnValueOnce(makeSelectChain([{ numberFormats: null }]))
      .mockReturnValueOnce(makeSelectChain([])) // number free
      .mockReturnValueOnce(makeSelectChain([liveTenant]))
      .mockReturnValueOnce(makeSelectChain([contact]))
      .mockReturnValueOnce(makeSelectChain([account]));
    const update = vi.fn().mockReturnValue(makeUpdateChain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert: vi.fn().mockReturnValue(makeSequenceInsertChain(1)), update } as any;

    await service.issue(db, "tenant-1", "inv-1", "user-1");

    const setArg = (update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(setArg.sellerSnapshot).toMatchObject({
      legalName: "Firma s.r.o.",
      dic: "CZ12345678",
      addressStreet: "Nová 2",
      bankAccountNumber: "2000",
      bankAccountBankCode: "0800",
      source: "issue",
    });
    expect(setArg.buyerSnapshot).toMatchObject({ legalName: "ACME s.r.o.", ico: "87654321", addressStreet: "Jiná 5", source: "issue" });
  });

  const pdfFor = async (invoice: ReturnType<typeof makeInvoice>) => {
    const select = vi
      .fn(() => makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain([makeContact({ legalName: "ACME nově", ico: "11111111" })]))
      .mockReturnValueOnce(makeSelectChain([liveTenant]))
      .mockReturnValueOnce(makeSelectChain(lineItems));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.generateInvoicePdf({ select } as any, "tenant-1", "inv-1");
    const [, contact, tenant] = invoicePdfService.generate.mock.calls[0]!;
    return { contact, tenant };
  };

  it("prints the snapshot taken at issue, not today's details", async () => {
    const { contact, tenant } = await pdfFor(
      makeInvoice({
        sellerSnapshot: { legalName: "Firma v.o.s.", dic: null, addressStreet: "Stará 1", bankAccountNumber: "999" },
        buyerSnapshot: { legalName: "ACME tehdy", ico: "22222222" },
      }),
    );
    expect(tenant).toMatchObject({ legalName: "Firma v.o.s.", dic: null, addressStreet: "Stará 1", bankAccountNumber: "999", addressCity: "Brno" });
    expect(contact).toMatchObject({ legalName: "ACME tehdy", ico: "22222222" });
  });

  it("an edit of an issued document keeps its snapshot unless the customer or the account changes", async () => {
    const snap = { legalName: "Firma v.o.s.", bankAccountNumber: "999", bankAccountBankCode: "0300" };
    const invoice = makeInvoice({ sellerSnapshot: snap, buyerSnapshot: { legalName: "ACME tehdy" }, bankAccountId: null }) as never;
    const edit = (values: Record<string, unknown>, select = vi.fn(() => makeSelectChain([]))) =>
      (service as unknown as { snapshotAfterEdit: (...a: unknown[]) => Promise<unknown[]> }).snapshotAfterEdit({ select }, "tenant-1", invoice, values);

    const kept: Record<string, unknown> = { noteBelow: "díky", dueDate: new Date("2026-10-01") };
    const select = vi.fn(() => makeSelectChain([]));
    expect(await edit(kept, select)).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(kept).not.toHaveProperty("sellerSnapshot");
    expect(kept).not.toHaveProperty("buyerSnapshot");

    const other: Record<string, unknown> = { contactId: "contact-2" };
    await edit(other, vi.fn(() => makeSelectChain([makeContact({ id: "contact-2", legalName: "Jiný odběratel" })])));
    expect(other.buyerSnapshot).toMatchObject({ legalName: "Jiný odběratel" });
    expect(other).not.toHaveProperty("sellerSnapshot");

    const rebanked: Record<string, unknown> = { currency: "EUR" };
    await edit(rebanked, vi.fn(() => makeSelectChain([liveTenant])));
    expect(rebanked.sellerSnapshot).toEqual({ ...snap, bankAccountNumber: "1000", bankAccountBankCode: "0100", bankAccountIban: null, bankAccountSwift: null });
  });

  it("prints the live details for a document without a snapshot", async () => {
    const { contact, tenant } = await pdfFor(makeInvoice({ sellerSnapshot: null, buyerSnapshot: null }));
    expect(tenant).toMatchObject({ legalName: "Firma s.r.o.", dic: "CZ12345678", addressStreet: "Nová 2", bankAccountNumber: "1000" });
    expect(contact).toMatchObject({ legalName: "ACME nově", ico: "11111111" });
  });
});

describe("InvoicesService.duplicateTemplate", () => {
  const service = new InvoicesService({} as unknown as EmailService, {} as unknown as InvoicePdfService);

  it("returns the customer, currency, payment term and items without writing anything", async () => {
    const items = [
      { description: "Konzultace", quantity: "3.000", unitPrice: "1500.00", vatRate: "21.00", unit: "hod", discountPercent: "0.00", sortOrder: 0 },
      { description: "Cestovné", quantity: "1.000", unitPrice: "400.00", vatRate: null, unit: null, discountPercent: "10.00", sortOrder: 1 },
    ];
    const chain = vi
      .fn()
      .mockReturnValueOnce(makeSelectChain([makeInvoice()]))
      .mockReturnValueOnce(makeSelectChain([makeContact()]))
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(items) }) }) });
    const db = { select: chain, insert: vi.fn(), update: vi.fn() };

    const template = await service.duplicateTemplate(db as never, "inv-1");

    expect(template.contact?.legalName).toBe("ACME s.r.o.");
    expect(template.dueInDays).toBe(14);
    expect(template.items).toEqual([
      { description: "Konzultace", quantity: 3, unit: "hod", discountPercent: 0, unitPrice: 1500, vatRate: 21 },
      { description: "Cestovné", quantity: 1, unit: null, discountPercent: 10, unitPrice: 400, vatRate: null },
    ]);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("404s for an invoice the tenant cannot see", async () => {
    const db = { select: vi.fn(() => makeSelectChain([])) };
    await expect(service.duplicateTemplate(db as never, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
