import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { pdfFilename, PublicInvoicesService } from "./public-invoices.service";

const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A pool whose execute() answers public_invoice_blocked, then get_public_invoice_view. */
function make(view: Record<string, unknown> | undefined, blocked = false) {
  const execute = vi.fn().mockResolvedValueOnce([{ blocked }]).mockResolvedValueOnce(view ? [view] : []);
  const tenantSet: unknown[] = [];
  const tx = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
    tenantSet.push(values[0]);
    return Promise.resolve([]);
  });
  const sql = { begin: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const generateInvoicePdf = vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7"));
  const service = new PublicInvoicesService({ db: { execute }, sql } as never, undefined, undefined, { generateInvoicePdf } as never);
  return { service, sql, generateInvoicePdf, tenantSet };
}

describe("PublicInvoicesService.generatePdf", () => {
  const issued = { id: "inv-1", tenant_id: "tenant-1", invoice_number: "FV 2026/001", status: "issued" };

  it("renders in a transaction scoped to the invoice's own tenant", async () => {
    const { service, generateInvoicePdf, tenantSet } = make(issued);
    const pdf = await service.generatePdf(TOKEN);
    expect(tenantSet).toEqual(["tenant-1"]);
    expect(generateInvoicePdf).toHaveBeenCalledWith(expect.anything(), "tenant-1", "inv-1");
    expect(pdf.filename).toBe("FV-2026-001.pdf");
    expect(pdf.content.toString()).toBe("%PDF-1.7");
  });

  it("is a 404 for a link that resolves to no token", async () => {
    const { service, sql } = make(issued);
    await expect(service.generatePdf("not-a-token")).rejects.toBeInstanceOf(NotFoundException);
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown token", undefined, false],
    ["a suspended company", issued, true],
    ["a draft", { ...issued, invoice_number: null, status: "draft" }, false],
    ["an AI draft awaiting review", { ...issued, status: "pending_review" }, false],
  ])("is a 404 for %s", async (_label, view, blocked) => {
    const { service, sql } = make(view, blocked);
    await expect(service.generatePdf(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    expect(sql.begin).not.toHaveBeenCalled();
  });
});

describe("pdfFilename", () => {
  it("keeps a plain number and makes anything else header-safe", () => {
    expect(pdfFilename("2026001")).toBe("2026001.pdf");
    expect(pdfFilename('Záloha "č." 5/26')).toBe("Zaloha-c.-5-26.pdf");
    expect(pdfFilename("../..")).toBe("invoice.pdf");
  });
});
