import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import { InvoiceImportService } from "./invoice-import.service";
import type { ImportedInvoice } from "./invoice-import.util";

const source = (id: number, number: string) => ({ id, number }) as never;

/** Runs the BitFaktura import with the invoice writes stubbed, so only the PDF archiving is exercised. */
async function run(pdfFor: (url: string) => Response | Promise<Response>, dryRun = false) {
  const service = new InvoiceImportService();
  const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = { insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => void inserted.push({ table, values }) }) };
  vi.spyOn(service as never, "importMapped").mockImplementation((async (
    _db: unknown,
    _tenant: string,
    mapped: { invoices: ImportedInvoice[] },
    _dry: boolean,
    onCreated?: (inv: ImportedInvoice, id: string) => void,
  ) => {
    if (!_dry) mapped.invoices.forEach((inv, i) => onCreated?.(inv, `inv-${i}`));
    return { dryRun: _dry, invoices: mapped.invoices.length };
  }) as never);
  const fetcher = async (url: string) => {
    if (url.includes("/invoices.json")) {
      return new Response(JSON.stringify([source(11, "1/10/2026"), source(12, "2/10/2026"), source(13, "3/10/2026")]), { status: 200 });
    }
    return pdfFor(url);
  };
  // The stubbed importMapped receives whatever the mapper produced; give it complete invoices.
  vi.spyOn(await import("./bitfaktura-import"), "mapBitfakturaInvoices").mockImplementation((src) => ({
    invoices: (src as { id: number; number: string }[]).map((s) => ({ invoiceNumber: s.number, sourceId: s.id }) as ImportedInvoice),
    skipped: [],
  }));
  const result = await service.importFromBitfaktura(db as never, "tenant-1", "firma", "t0ken-xyz", dryRun, fetcher as never);
  return { result, inserted };
}

describe("InvoiceImportService.importFromBitfaktura – original PDFs", () => {
  it("stores each original PDF as a private archive attachment and counts the missing ones", async () => {
    const { result, inserted } = await run((url) =>
      url.endsWith("/12.pdf") ? new Response("not found", { status: 404 }) : new Response(`%PDF-1.4 ${url}`, { status: 200 }),
    );
    expect(result.originalPdfs).toEqual({ archived: 2, missing: 1 });
    expect(inserted.every((r) => r.table === schema.invoiceAttachments)).toBe(true);
    const rows = inserted.map((r) => r.values).sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    expect(rows.map((r) => [r.filename, r.invoiceId, r.tenantId, r.mime, r.sendWithEmail, r.showInPortal])).toEqual([
      ["1-10-2026-bitfaktura.pdf", "inv-0", "tenant-1", "application/pdf", false, false],
      ["3-10-2026-bitfaktura.pdf", "inv-2", "tenant-1", "application/pdf", false, false],
    ]);
    expect(Buffer.from(String(rows[1]!.data), "base64").toString()).toBe("%PDF-1.4 https://firma.bitfaktura.cz/invoices/13.pdf");
    expect(rows[1]!.sizeBytes).toBe(Buffer.from(String(rows[1]!.data), "base64").length);
  });

  it("downloads nothing on a preview", async () => {
    const { result, inserted } = await run(() => {
      throw new Error("must not download on a dry run");
    }, true);
    expect(result.originalPdfs).toBeUndefined();
    expect(inserted).toEqual([]);
  });
});
