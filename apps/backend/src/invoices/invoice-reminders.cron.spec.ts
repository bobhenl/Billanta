import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailService } from "../email/email.service";
import { InvoiceRemindersCron } from "./invoice-reminders.cron";
import type { InvoiceRemindersRepository, OverdueInvoiceForReminder } from "./invoice-reminders.repository";

type MockRepository = {
  listAllTenantIds: ReturnType<typeof vi.fn>;
  findOverdueInvoicesForTenant: ReturnType<typeof vi.fn>;
  recordReminderSent: ReturnType<typeof vi.fn>;
  assertCanSend: ReturnType<typeof vi.fn>;
};
type MockEmailService = {
  sendPaymentReminderEmail: ReturnType<typeof vi.fn>;
};

function makeOverdueInvoice(overrides: Partial<OverdueInvoiceForReminder> = {}): OverdueInvoiceForReminder {
  return {
    invoice: {
      id: "inv-1",
      tenantId: "tenant-1",
      contactId: "contact-1",
      invoiceNumber: "2026-0001",
      variableSymbol: null,
      issueDate: new Date("2026-08-01"),
      dueDate: new Date("2026-08-15"),
      currency: "CZK",
      status: "issued",
      source: "manual",
      aiConfidenceScore: null,
      issuedByUserId: null,
      issuedAt: new Date("2026-08-01"),
      aiDraftReviewedAt: null,
      needsAttention: false,
      rawAiPayload: null,
      publicToken: "11111111-1111-1111-1111-111111111111",
      sentAt: new Date("2026-08-01"),
      lastReminderSentAt: null,
      reminderCount: 0,
      createdAt: new Date("2026-08-01"),
      updatedAt: new Date("2026-08-01"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    contactEmail: "client@example.com",
    lineItems: [
      {
        id: "li-1",
        tenantId: "tenant-1",
        invoiceId: "inv-1",
        description: "Consulting",
        quantity: "2",
        unitPrice: "1000",
        vatRate: "21",
        sortOrder: 0,
        createdAt: new Date("2026-08-01"),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
    ...overrides,
  };
}

describe("InvoiceRemindersCron", () => {
  let repository: MockRepository;
  let emailService: MockEmailService;
  let cron: InvoiceRemindersCron;

  beforeEach(() => {
    repository = {
      listAllTenantIds: vi.fn(),
      findOverdueInvoicesForTenant: vi.fn(),
      recordReminderSent: vi.fn().mockResolvedValue(undefined),
      assertCanSend: vi.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendPaymentReminderEmail: vi.fn().mockResolvedValue(undefined),
    };
    cron = new InvoiceRemindersCron(
      repository as unknown as InvoiceRemindersRepository,
      emailService as unknown as EmailService,
    );
  });

  it("sends nothing and touches no tenant when no tenants exist", async () => {
    repository.listAllTenantIds.mockResolvedValue([]);

    await cron.sendOverdueReminders();

    expect(repository.findOverdueInvoicesForTenant).not.toHaveBeenCalled();
    expect(emailService.sendPaymentReminderEmail).not.toHaveBeenCalled();
  });

  it("scans every tenant returned by listAllTenantIds, even ones with nothing overdue", async () => {
    repository.listAllTenantIds.mockResolvedValue(["tenant-1", "tenant-2"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([]);

    await cron.sendOverdueReminders();

    expect(repository.findOverdueInvoicesForTenant).toHaveBeenCalledWith("tenant-1");
    expect(repository.findOverdueInvoicesForTenant).toHaveBeenCalledWith("tenant-2");
    expect(emailService.sendPaymentReminderEmail).not.toHaveBeenCalled();
  });

  it("sends a reminder email and records it for an eligible overdue invoice", async () => {
    const overdue = makeOverdueInvoice();
    repository.listAllTenantIds.mockResolvedValue(["tenant-1"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([overdue]);

    await cron.sendOverdueReminders();

    expect(emailService.sendPaymentReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "client@example.com",
        invoiceNumber: "2026-0001",
        amount: "2420.00 CZK", // 2 * 1000 * 1.21
        dueDate: overdue.invoice.dueDate,
        publicToken: overdue.invoice.publicToken,
        reminderCount: 1, // reminderCount (0) + 1
      }),
    );
    expect(repository.recordReminderSent).toHaveBeenCalledWith("tenant-1", "inv-1", expect.any(String));
  });

  it("skips (and never records) an overdue invoice whose contact has no email", async () => {
    const overdue = makeOverdueInvoice({ contactEmail: null });
    repository.listAllTenantIds.mockResolvedValue(["tenant-1"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([overdue]);

    await cron.sendOverdueReminders();

    expect(emailService.sendPaymentReminderEmail).not.toHaveBeenCalled();
    expect(repository.recordReminderSent).not.toHaveBeenCalled();
  });

  it("does not record the reminder if sending the email throws, and keeps going", async () => {
    const failing = makeOverdueInvoice({
      invoice: { ...makeOverdueInvoice().invoice, id: "inv-fail" } as OverdueInvoiceForReminder["invoice"],
    });
    const succeeding = makeOverdueInvoice({
      invoice: { ...makeOverdueInvoice().invoice, id: "inv-ok" } as OverdueInvoiceForReminder["invoice"],
    });
    repository.listAllTenantIds.mockResolvedValue(["tenant-1"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([failing, succeeding]);
    emailService.sendPaymentReminderEmail
      .mockRejectedValueOnce(new Error("Resend outage"))
      .mockResolvedValueOnce(undefined);

    await expect(cron.sendOverdueReminders()).resolves.toBeUndefined();

    expect(repository.recordReminderSent).not.toHaveBeenCalledWith("tenant-1", "inv-fail");
    expect(repository.recordReminderSent).toHaveBeenCalledWith("tenant-1", "inv-ok", expect.any(String));
  });

  it("bumps reminderCount by one relative to the invoice's current count (second reminder)", async () => {
    const overdue = makeOverdueInvoice({
      invoice: { ...makeOverdueInvoice().invoice, reminderCount: 1 } as OverdueInvoiceForReminder["invoice"],
    });
    repository.listAllTenantIds.mockResolvedValue(["tenant-1"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([overdue]);

    await cron.sendOverdueReminders();

    expect(emailService.sendPaymentReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ reminderCount: 2 }),
    );
  });

  it("skips sending when the company may not send (suspended, paused or over the cap)", async () => {
    repository.listAllTenantIds.mockResolvedValue(["tenant-1"]);
    repository.findOverdueInvoicesForTenant.mockResolvedValue([makeOverdueInvoice()]);
    repository.assertCanSend.mockRejectedValue(new Error("EMAIL_PAUSED"));

    await cron.sendOverdueReminders();

    expect(emailService.sendPaymentReminderEmail).not.toHaveBeenCalled();
    expect(repository.recordReminderSent).not.toHaveBeenCalled();
  });
});
