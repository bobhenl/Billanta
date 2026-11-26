import { randomBytes } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expensesCsv } from "./document-archive.service";
import { ZipWriter } from "./zip-writer";

interface Parsed {
  name: string;
  flags: number;
  method: number;
  data: Buffer;
}

/** Reads a ZIP the way unzip tools do: from the central directory at the end. */
function readZip(zip: Buffer): Parsed[] {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  const cdSize = zip.readUInt32LE(eocd + 12);
  let p = zip.readUInt32LE(eocd + 16);
  expect(p + cdSize).toBe(eocd);
  const out: Parsed[] = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const offset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // The local header must agree with the central one.
    expect(zip.readUInt32LE(offset)).toBe(0x04034b50);
    expect(zip.readUInt32LE(offset + 14)).toBe(crc);
    const localName = zip.readUInt16LE(offset + 26);
    const localExtra = zip.readUInt16LE(offset + 28);
    expect(zip.subarray(offset + 30, offset + 30 + localName).toString("utf8")).toBe(name);
    const start = offset + 30 + localName + localExtra;
    const body = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(data.length).toBe(size);
    expect(crc32(data) >>> 0).toBe(crc);
    out.push({ name, flags, method, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function build(files: [string, Buffer][]) {
  const chunks: Buffer[] = [];
  const zip = new ZipWriter((c) => void chunks.push(c));
  for (const [name, data] of files) await zip.add(name, data, new Date(2026, 2, 2, 10, 30, 0));
  await zip.finish();
  return { zip: Buffer.concat(chunks), count: zip.count };
}

describe("ZipWriter", () => {
  it("writes a ZIP that reads back byte for byte, with UTF-8 names", async () => {
    const text = Buffer.from("Faktura ".repeat(200));
    const random = randomBytes(2048);
    const { zip, count } = await build([
      ["Billanta/2026/vydane/2026-0001.pdf", random],
      ["Billanta/2026/naklady/2026-03-02_Žluťoučký kůň_1.xml", text],
      ["prázdný.txt", Buffer.alloc(0)],
    ]);
    expect(count).toBe(3);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual([
      "Billanta/2026/vydane/2026-0001.pdf",
      "Billanta/2026/naklady/2026-03-02_Žluťoučký kůň_1.xml",
      "prázdný.txt",
    ]);
    expect(entries.every((e) => (e.flags & 0x0800) !== 0)).toBe(true);
    expect(entries[0].data.equals(random)).toBe(true);
    expect(entries[1].data.equals(text)).toBe(true);
    expect(entries[2].data.length).toBe(0);
  });

  it("deflates text and stores data that does not compress", async () => {
    const { zip } = await build([
      ["a.txt", Buffer.from("a".repeat(5000))],
      ["b.bin", randomBytes(4096)],
    ]);
    const [a, b] = readZip(zip);
    expect(a.method).toBe(8);
    expect(b.method).toBe(0);
    expect(zip.length).toBeLessThan(5000 + 4096);
  });

  it("refuses a duplicate name and anything after finish", async () => {
    const zip = new ZipWriter(() => undefined);
    await zip.add("a.pdf", Buffer.from("1"));
    await expect(zip.add("a.pdf", Buffer.from("2"))).rejects.toThrow(/duplicate/);
    await zip.finish();
    await expect(zip.add("b.pdf", Buffer.from("3"))).rejects.toThrow(/finished/);
  });

  it("waits for the sink, so a slow download applies backpressure", async () => {
    const order: string[] = [];
    const zip = new ZipWriter(async () => {
      await new Promise((r) => setTimeout(r, 1));
      order.push("chunk");
    });
    await zip.add("a.txt", Buffer.from("x"));
    order.push("added");
    expect(order).toEqual(["chunk", "chunk", "added"]);
  });
});

describe("expensesCsv", () => {
  const row = {
    id: "e1",
    expenseDate: new Date("2026-03-02T08:00:00Z"),
    supplierIco: "27082440",
    supplierDic: "CZ27082440",
    documentNumber: "123",
    variableSymbol: "123",
    description: "=HYPERLINK(\"x\")",
    category: "software",
    amount: "1210.50",
    vatRate: "21",
    currency: "CZK",
    reverseCharge: false,
    dueDate: null,
    paidAt: new Date("2026-03-10T12:00:00Z"),
    receiptFileUrl: "https://example.com/r.pdf",
    note: null,
  };

  it("opens in Czech Excel: BOM, semicolons, decimal comma, no formulas", () => {
    const csv = expensesCsv([row] as never, () => "Alza.cz a.s.").toString("utf8");
    expect(csv.startsWith("﻿Datum;Dodavatel;IČO")).toBe(true);
    const line = csv.split("\r\n")[1];
    expect(line).toContain("2026-03-02;Alza.cz a.s.;27082440");
    expect(line).toContain("1210,5");
    expect(line).not.toMatch(/;=HYPERLINK/);
    expect(line).toContain("2026-03-10");
  });
});
