import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readTableFile } from "../common/table-file";
import { writeXlsxFixture } from "../common/xlsx-fixture";
import { numberingSuggestions } from "./import-numbering";
import { detectImportSource, planImport, type ImportSource } from "./invoice-import-sources";
import { InvoiceImportService } from "./invoice-import.service";
import { mapInvoiceRows } from "./invoice-import.util";

/**
 * One made-up export per tool (`import-samples/*.csv`, our own data in the
 * columns those tools typically export), read as CSV and as .xlsx.
 */
const SAMPLES: { source: ImportSource; invoices: number; pattern: string | null; currency: string }[] = [
  { source: "fakturoid", invoices: 3, pattern: null, currency: "CZK" },
  { source: "idoklad", invoices: 3, pattern: "{YY}{NNNN}", currency: "CZK" },
  { source: "superfaktura", invoices: 3, pattern: "{YYYY}{NNN}", currency: "EUR" },
  { source: "vyfakturuj", invoices: 2, pattern: "FV{YYYY}{NNN}", currency: "CZK" },
  { source: "kros", invoices: 3, pattern: "{YYYY}{NNNN}", currency: "EUR" },
  { source: "billdu", invoices: 3, pattern: "{YYYY}/{NNNN}", currency: "EUR" },
  { source: "bitfaktura", invoices: 3, pattern: "{N}/{MM}/{YYYY}", currency: "CZK" },
];

const sample = (source: ImportSource) => readFileSync(join(__dirname, "import-samples", `${source}.csv`));
const asXlsx = (csv: Buffer) => writeXlsxFixture(readTableFile(csv));
const NOW = new Date(Date.UTC(2025, 9, 20));

describe.each(SAMPLES)("$source export", ({ source, invoices, pattern, currency }) => {
  for (const [kind, file] of [
    ["csv", () => sample(source)],
    ["xlsx", () => asXlsx(sample(source))],
  ] as const) {
    it(`is recognised and maps without help (${kind})`, () => {
      const rows = readTableFile(file());
      expect(detectImportSource(rows[0]!)).toBe(source);
      const plan = planImport(rows);
      expect(plan.missing).toEqual([]);
      const mapped = mapInvoiceRows(rows, plan.columns);
      expect(mapped.skipped).toEqual([]);
      expect(mapped.invoices).toHaveLength(invoices);
      for (const inv of mapped.invoices) {
        expect(inv.currency).toBe(currency);
        expect(inv.customer.legalName).toBeTruthy();
        expect(inv.lines.length).toBeGreaterThan(0);
      }
    });
  }

  it("suggests the numbering the file continues", () => {
    const rows = readTableFile(sample(source));
    const mapped = mapInvoiceRows(rows, planImport(rows).columns);
    const found = numberingSuggestions(mapped.invoices, {}, NOW);
    expect(found[0]?.pattern ?? null).toBe(pattern);
  });
});

describe("sample details", () => {
  const read = (source: ImportSource) => {
    const rows = readTableFile(sample(source));
    return mapInvoiceRows(rows, planImport(rows).columns).invoices;
  };

  it("keeps line items and paid dates (Vyfakturuj)", () => {
    const [first, second] = read("vyfakturuj");
    expect(first!.lines.map((l) => l.description)).toEqual(["Webové stránky", "Hosting na rok"]);
    expect(first!.status).toBe("paid");
    expect(second!.lines[0]).toMatchObject({ quantity: 3, unitPrice: 1200, vatRate: 21 });
  });

  it("reads the Slovak IČ DPH as the VAT id, not the DIČ (SuperFaktúra, KROS)", () => {
    expect(read("superfaktura")[0]!.customer).toMatchObject({ ico: "50123456", dic: "SK2120123456" });
    expect(read("kros")[0]!.customer).toMatchObject({ ico: "50345678", dic: "SK2120345678" });
  });

  it("derives the VAT rate from the totals (iDoklad, KROS)", () => {
    expect(read("idoklad")[0]!.lines[0]).toMatchObject({ unitPrice: 8000, vatRate: 21 });
    expect(read("kros")[0]!.lines[0]).toMatchObject({ unitPrice: 2500, vatRate: 23 });
  });

  it("reads statuses (iDoklad, Billdu, BitFaktura)", () => {
    expect(read("idoklad").map((i) => i.status)).toEqual(["paid", "issued", "issued"]);
    expect(read("billdu").map((i) => i.status)).toEqual(["paid", "issued", "issued"]);
    expect(read("bitfaktura").map((i) => i.status)).toEqual(["paid", "issued", "issued"]);
  });

  it("next number continues the imported row", () => {
    const rows = readTableFile(sample("vyfakturuj"));
    const [s] = numberingSuggestions(mapInvoiceRows(rows, planImport(rows).columns).invoices, {}, NOW);
    expect(s!.nextNumber).toBe("FV2025019");
  });
});

describe("InvoiceImportService.importCsv – file preview", () => {
  const service = () => {
    const s = new InvoiceImportService();
    const spy = vi.spyOn(s as never, "importMapped").mockImplementation((async (_db: unknown, _t: string, mapped: { invoices: unknown[] }, dryRun: boolean) => ({
      dryRun,
      invoices: mapped.invoices.length,
    })) as never);
    return { s, spy };
  };

  it("previews an xlsx export with its source and columns", async () => {
    const { s } = service();
    const result = await s.importCsv({} as never, "t", asXlsx(sample("billdu")), true);
    expect(result).toMatchObject({ invoices: 3, detectedSource: "billdu" });
    expect(result.columns![0]).toMatchObject({ header: "Document No.", field: "number", samples: ["2025/0007", "2025/0008", "2025/0009"] });
  });

  it("asks for a mapping instead of failing when a required column is unknown", async () => {
    const { s, spy } = service();
    const csv = Buffer.from("Doklad č.;Firma;Den;Kolik\nA1;Nějaká firma;1.10.2025;100\n");
    const result = await s.importCsv({} as never, "t", csv, true);
    expect(result.mappingRequired).toEqual(["number", "amount"]);
    expect(result.invoices).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    await expect(s.importCsv({} as never, "t", csv, false)).rejects.toMatchObject({ response: { error: "unknown_columns" } });

    const fixed = await s.importCsv({} as never, "t", csv, true, { mapping: ["number", "customer", "issueDate", "totalGross"] });
    expect(fixed.mappingRequired).toBeUndefined();
    expect(fixed.invoices).toBe(1);
    expect(fixed.columns!.map((c) => c.field)).toEqual(["number", "customer", "issueDate", "totalGross"]);
  });

  it("refuses the old binary .xls with its own code", async () => {
    const { s } = service();
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(s.importCsv({} as never, "t", xls, true)).rejects.toMatchObject({ response: { error: "xls_unsupported" } });
  });
});
