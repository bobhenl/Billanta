import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { EmailOutboxService } from "./email-outbox.service";
import { EmailService } from "./email.service";

/** Nothing leaves the process: the outbox is a mock and Resend is never configured. */
function setup() {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const config = { get: () => undefined } as unknown as ConfigService;
  const service = new EmailService(config, { enqueue } as unknown as EmailOutboxService);
  const sent = () => enqueue.mock.calls[0][0] as { subject: string; html: string };
  return { service, sent };
}

const base = {
  to: "client@example.com",
  invoiceNumber: "2026-0001",
  amount: "1815.00 CZK",
  dueDate: new Date("2026-09-15"),
  publicLink: "2026-0001-aZ09bY18cX27",
};
const queue = { tenantId: "tenant-1" };

describe("EmailService invoice e-mail language", () => {
  it("writes Czech by default and the invoice's own language otherwise", async () => {
    const cs = setup();
    await cs.service.sendInvoiceEmail(base, queue);
    expect(cs.sent().subject).toBe("Faktura 2026-0001");
    expect(cs.sent().html).toContain('lang="cs"');

    const sk = setup();
    await sk.service.sendInvoiceEmail({ ...base, language: "sk" }, queue);
    expect(sk.sent().subject).toBe("Faktúra 2026-0001");
    expect(sk.sent().html).toContain("Číslo faktúry");

    const en = setup();
    await en.service.sendInvoiceEmail({ ...base, language: "en" }, queue);
    expect(en.sent().subject).toBe("Invoice 2026-0001");
    expect(en.sent().html).toContain('lang="en"');
    expect(en.sent().html).not.toContain("Splatnost");
  });

  it("reminds in the invoice's language", async () => {
    const { service, sent } = setup();
    await service.sendPaymentReminderEmail({ ...base, language: "en", reminderCount: 1 }, queue);
    expect(sent().subject).toMatch(/^Reminder/);
    expect(sent().html).not.toContain("Upomínka");
  });
});

describe("EmailService credit note e-mail", () => {
  it("presents a credit note as a correction, not as something to pay", async () => {
    const { service, sent } = setup();
    await service.sendInvoiceEmail({ ...base, amount: "-1815.00 CZK", documentType: "credit_note" }, queue);
    expect(sent().subject).toBe("Opravný daňový doklad 2026-0001");
    expect(sent().html).toContain("snižuje částku původní faktury");
    expect(sent().html).not.toContain("možnosti úhrady");
    expect(sent().html).not.toContain("Splatnost");
    expect(sent().html).toContain("Zobrazit doklad");
  });

  it("uses the Slovak name for a Slovak credit note", async () => {
    const { service, sent } = setup();
    await service.sendInvoiceEmail({ ...base, documentType: "credit_note", language: "sk" }, queue);
    expect(sent().subject).toBe("Dobropis 2026-0001");
  });
});
