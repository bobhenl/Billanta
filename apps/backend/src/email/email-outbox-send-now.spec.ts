import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import { EmailOutboxService } from "./email-outbox.service";

/** Records what reaches the table: the inserted row and every later update. */
function fakeDb(opts: { inserted?: boolean; suppressed?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () => (opts.inserted === false ? [] : [{ ...v, id: "row-1" }]),
          }),
        };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: async () => undefined };
      },
    }),
    execute: async () => [{ suppressed: !!opts.suppressed }],
  };
  return { db, inserts, updates };
}

const email = {
  kind: "invoice_sent",
  category: "transactional" as const,
  to: " client@example.com ",
  subject: "Faktura 2026-0001",
  html: "<p>Faktura</p>",
  attachments: [{ filename: "2026-0001.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-secret") }],
};

const service = new EmailOutboxService({} as DbService);
const ok = async () => ({ ok: true as const, providerId: "re_1" });

describe("EmailOutboxService.sendNow", () => {
  it("delivers the files from memory and never writes them to the outbox", async () => {
    const { db, inserts, updates } = fakeDb();
    const deliver = vi.fn(ok);
    expect(await service.sendNow(email, { tenantId: "t-1", db: db as never }, deliver)).toBe("sent");

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]![0].attachments).toEqual([
      { filename: "2026-0001.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-secret").toString("base64") },
    ]);
    expect(inserts[0]).toMatchObject({ attachments: null, status: "sending", maxAttempts: 1, recipient: "client@example.com" });
    expect(updates).toEqual([expect.objectContaining({ status: "sent", providerMessageId: "re_1", lockedUntil: null })]);
    const stored = JSON.stringify([...inserts, ...updates]);
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain(Buffer.from("%PDF-secret").toString("base64"));
  });

  it("sends nothing when the row is dropped (demo company, same click twice)", async () => {
    const { db, updates } = fakeDb({ inserted: false });
    const deliver = vi.fn(ok);
    expect(await service.sendNow(email, { tenantId: "t-1", db: db as never }, deliver)).toBe("skipped");
    expect(deliver).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("sends nothing to a suppressed address", async () => {
    const { db, updates } = fakeDb({ suppressed: true });
    const deliver = vi.fn(ok);
    expect(await service.sendNow(email, { tenantId: "t-1", db: db as never }, deliver)).toBe("suppressed");
    expect(deliver).not.toHaveBeenCalled();
    expect(updates).toEqual([expect.objectContaining({ status: "suppressed" })]);
  });

  it("reports a failed delivery and keeps only the provider's message", async () => {
    const { db, updates } = fakeDb();
    const deliver = vi.fn(async () => ({ ok: false as const, name: "validation_error", message: "bad recipient", retryable: false }));
    await expect(service.sendNow(email, { tenantId: "t-1", db: db as never }, deliver)).rejects.toThrow(ServiceUnavailableException);
    expect(updates).toEqual([expect.objectContaining({ status: "dead", lastError: "validation_error: bad recipient" })]);
  });
});
