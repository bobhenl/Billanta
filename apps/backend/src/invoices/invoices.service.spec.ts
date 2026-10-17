import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
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
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice])) // load invoice
      .mockReturnValueOnce(makeSelectChain(lineItems)); // load line items
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
      .fn()
      .mockReturnValueOnce(makeSelectChain([invoice]))
      .mockReturnValueOnce(makeSelectChain(lineItems));
    const insert = vi.fn().mockReturnValue(makeSequenceInsertChain(1));
    const update = vi.fn().mockReturnValue(makeUpdateChain([updated]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, insert, update } as any;

    await service.issue(db, "tenant-1", "inv-1", "user-1");

    const setArg = (update.mock.results[0]!.value.set as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(setArg.aiDraftReviewedAt).toBeInstanceOf(Date);
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
      .mockReturnValueOnce(makeSelectChain([makeInvoice({ bankAccountId: "acc-2" })]))
      .mockReturnValueOnce(makeSelectChain([makeContact()]))
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve(items) }) }) });
    const db = { select: chain, insert: vi.fn(), update: vi.fn() };

    const template = await service.duplicateTemplate(db as never, "inv-1");

    expect(template.contact?.legalName).toBe("ACME s.r.o.");
    expect(template.dueInDays).toBe(14);
    expect(template.bankAccountId).toBe("acc-2");
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

describe("InvoicesService.latestDuplicateTemplate", () => {
  const service = new InvoicesService({} as unknown as EmailService, {} as unknown as InvoicePdfService);
  const dialect = new PgDialect();

  function latestChain(rows: { id: string }[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(rows));
    return chain;
  }

  it("copies the newest non-credit-note document and writes nothing", async () => {
    const latest = latestChain([{ id: "inv-9" }]);
    const db = { select: vi.fn().mockReturnValueOnce(latest), insert: vi.fn(), update: vi.fn() };
    const duplicate = vi.spyOn(service, "duplicateTemplate").mockResolvedValue({ sourceNumber: "2026-0009" } as never);

    const template = await service.latestDuplicateTemplate(db as never);

    expect(duplicate).toHaveBeenCalledWith(db, "inv-9");
    expect(template.sourceNumber).toBe("2026-0009");
    const where = dialect.sqlToQuery(latest.where.mock.calls[0][0]);
    expect(where.sql).toBe('"invoices"."document_type" <> $1');
    expect(where.params).toEqual(["credit_note"]);
    const order = dialect.sqlToQuery(latest.orderBy.mock.calls[0][0]);
    expect(order.sql).toBe('"invoices"."created_at" desc');
    expect(latest.limit).toHaveBeenCalledWith(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    duplicate.mockRestore();
  });

  it("404s when the company has no invoice yet", async () => {
    const db = { select: vi.fn(() => latestChain([])) };
    await expect(service.latestDuplicateTemplate(db as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
