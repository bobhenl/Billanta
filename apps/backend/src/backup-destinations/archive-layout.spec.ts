import { describe, expect, it } from "vitest";
import {
  archiveYear,
  dedupeNames,
  expenseEInvoiceFile,
  expenseSummaryFile,
  invoiceAttachmentFiles,
  invoiceFiles,
  invoiceFingerprint,
  safeSegment,
} from "./archive-layout";

const inv = (over: Partial<Parameters<typeof invoiceFiles>[0]> = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  invoiceNumber: "2026-0001",
  documentType: "invoice" as const,
  issueDate: new Date("2026-03-02T10:00:00Z"),
  ...over,
});

describe("invoiceFiles", () => {
  it("puts a tax invoice as PDF and ISDOC under its year", () => {
    expect(invoiceFiles(inv()).map((f) => [f.kind, f.path, f.mime])).toEqual([
      ["pdf", "Billanta/2026/vydane/2026-0001.pdf", "application/pdf"],
      ["isdoc", "Billanta/2026/vydane/2026-0001.isdoc", "application/xml"],
    ]);
  });

  it("gives a credit note a PDF only, proformas their own folder, quotes nothing", () => {
    expect(invoiceFiles(inv({ documentType: "credit_note", invoiceNumber: "D-1" })).map((f) => f.path)).toEqual([
      "Billanta/2026/vydane/D-1.pdf",
    ]);
    expect(invoiceFiles(inv({ documentType: "proforma", invoiceNumber: "ZF-7" })).map((f) => f.path)).toEqual([
      "Billanta/2026/zalohove/ZF-7.pdf",
    ]);
    expect(invoiceFiles(inv({ documentType: "quote" }))).toEqual([]);
  });

  it("files a document issued on New Year's night in Prague under the new year", () => {
    // 23:30 UTC on 31 Dec is already 00:30 on 1 Jan in Prague.
    const d = new Date("2025-12-31T23:30:00Z");
    expect(archiveYear(d)).toBe(2026);
    expect(invoiceFiles(inv({ issueDate: d }))[0].path).toBe("Billanta/2026/vydane/2026-0001.pdf");
  });

  it("keeps a number with slashes inside its folder", () => {
    expect(invoiceFiles(inv({ invoiceNumber: "FV/2026/01" }))[0].path).toBe("Billanta/2026/vydane/FV-2026-01.pdf");
  });
});

describe("safeSegment", () => {
  it("removes path tricks and reserved characters but keeps diacritics", () => {
    expect(safeSegment("../../etc/passwd")).toBe("etc-passwd");
    expect(safeSegment('a<b>c:d"e|f?g*h')).toBe("a-b-c-d-e-f-g-h");
    expect(safeSegment("Žluťoučký kůň s.r.o.")).toBe("Žluťoučký kůň s.r.o");
    expect(safeSegment("new\nline\u0000")).toBe("newline");
    expect(safeSegment("...")).toBe("bez-nazvu");
    expect(safeSegment("x".repeat(200)).length).toBe(80);
  });
});

describe("attachments and expenses", () => {
  it("numbers repeated attachment names", () => {
    expect(invoiceAttachmentFiles(inv(), ["smlouva.pdf", "Smlouva.pdf", "foto"]).map((f) => f.path)).toEqual([
      "Billanta/2026/vydane/prilohy/2026-0001/smlouva.pdf",
      "Billanta/2026/vydane/prilohy/2026-0001/Smlouva (2).pdf",
      "Billanta/2026/vydane/prilohy/2026-0001/foto",
    ]);
    expect(dedupeNames(["a.pdf", "a.pdf", "a (2).pdf"])).toEqual(["a.pdf", "a (2).pdf", "a (2) (2).pdf"]);
  });

  it("names a received e-invoice by date, supplier and their number", () => {
    const base = { id: "abcdef12-0000-0000-0000-000000000000", expenseDate: new Date("2026-03-02T08:00:00Z") };
    expect(expenseEInvoiceFile({ ...base, supplierName: "Alza.cz a.s.", documentNumber: "123/26" }).path).toBe(
      "Billanta/2026/naklady/2026-03-02_Alza.cz a.s_123-26.xml",
    );
    expect(expenseEInvoiceFile({ ...base, supplierName: null, documentNumber: null }).path).toBe(
      "Billanta/2026/naklady/2026-03-02_dodavatel_abcdef12.xml",
    );
    expect(expenseSummaryFile(2025).path).toBe("Billanta/2025/naklady/naklady-2025.csv");
  });
});

describe("invoiceFingerprint", () => {
  const invoice = { id: "i1", invoiceNumber: "2026-0001", status: "issued", totalAmount: "1210.00", updatedAt: new Date(1), publicViewCount: 0 };
  const items = [
    { id: "b", sortOrder: 1, description: "Práce", unitPrice: "1000.00" },
    { id: "a", sortOrder: 0, description: "Doprava", unitPrice: "0.00" },
  ];
  const base = invoiceFingerprint(invoice, items);

  it("ignores columns that never reach the document", () => {
    expect(invoiceFingerprint({ ...invoice, updatedAt: new Date(2), publicViewCount: 5, internalNote: "x" }, items)).toBe(base);
    expect(invoiceFingerprint(invoice, [...items].reverse())).toBe(base);
  });

  it("changes when the amount, status or a line changes", () => {
    expect(invoiceFingerprint({ ...invoice, totalAmount: "1331.00" }, items)).not.toBe(base);
    expect(invoiceFingerprint({ ...invoice, status: "paid" }, items)).not.toBe(base);
    expect(invoiceFingerprint(invoice, [{ ...items[0], unitPrice: "1100.00" }, items[1]])).not.toBe(base);
  });
});
