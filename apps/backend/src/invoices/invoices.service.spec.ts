import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailService } from "../email/email.service";
import { InvoicesService } from "./invoices.service";

type MockEmailService = { sendInvoiceEmail: ReturnType<typeof vi.fn> };

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
  let service: InvoicesService;

  beforeEach(() => {
    emailService = { sendInvoiceEmail: vi.fn().mockResolvedValue(undefined) };
    service = new InvoicesService(emailService as unknown as EmailService);
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
