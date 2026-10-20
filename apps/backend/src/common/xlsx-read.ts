import { inflateRawSync } from "node:zlib";

/**
 * Just enough of an .xlsx reader for imports: the first worksheet as rows of
 * strings, the same shape `parseCsv` returns. Invoicing tools (iDoklad,
 * SuperFaktúra, KROS, Billdu…) export to Excel, and asking people to re-save
 * as CSV is where a move gets stuck.
 *
 * No dependency: an .xlsx is a zip of XML parts. Only what a data export
 * uses is read – shared and inline strings, numbers, booleans and date
 * formats (as YYYY-MM-DD). Formulas come across as their cached value.
 */

/** Decompressed size cap per zip entry, so a tiny file cannot expand into gigabytes. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export class XlsxError extends Error {}

export const isXlsx = (buf: Buffer) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

/** The old binary Excel format (OLE compound file), which this reader does not handle. */
export const isLegacyXls = (buf: Buffer) => buf.length > 8 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;

function unzip(buf: Buffer, wanted: (name: string) => boolean): Map<string, Buffer> {
  // End of central directory: the last 22+ bytes, after an optional comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("not_a_zip");
  const entries = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new XlsxError("bad_zip");
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (!wanted(name)) continue;
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new XlsxError("bad_zip");
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(start, start + compressedSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else throw new XlsxError("unsupported_compression");
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()]!,
  );

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The text of a string item: plain `<t>` or rich-text runs, without phonetic hints. */
const itemText = (xml: string) =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => decodeXml(m[1] ?? "")).join("");

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => itemText(m[1] ?? ""));
}

/** Built-in number formats that show a date (ECMA-376 18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Per cell-style index: does it display a date? */
function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = decodeXml(attr(m[0], "formatCode") ?? "");
    custom.set(id, code);
  }
  const isDateCode = (code: string) => {
    // Quoted text, escapes and [colour]/[locale] sections are not date parts.
    const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "");
    return /[dy]/i.test(bare) || /m/i.test(bare.replace(/[hs]+[^a-z]*m+|m+[^a-z]*s+/gi, ""));
  };
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  return [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateCode(custom.get(id)!));
  });
}

/** Excel's 1900 day count (with its phantom 29 Feb 1900) → YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** "A" → 0, "AB" → 27. */
const columnIndex = (ref: string) => {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Floating-point noise from Excel ("0.30000000000000004") trimmed off. */
const tidyNumber = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? String(Math.round(n * 1e9) / 1e9) : raw;
};

function firstSheetPath(files: Map<string, Buffer>): string {
  const workbook = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const sheet = /<sheet\b[^>]*>/.exec(workbook)?.[0];
  const rid = sheet ? attr(sheet, "r:id") : undefined;
  const rel = rid ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === rid) : undefined;
  const target = rel ? attr(rel, "Target") : undefined;
  if (!target) return "xl/worksheets/sheet1.xml";
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

/** The first worksheet of an .xlsx as rows of cell strings; trailing empty rows dropped. */
export function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf, (n) => n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml" || n === "xl/styles.xml" || n.startsWith("xl/worksheets/"));
  const sheetXml = files.get(firstSheetPath(files))?.toString("utf8") ?? files.get("xl/worksheets/sheet1.xml")?.toString("utf8");
  if (!sheetXml) throw new XlsxError("no_sheet");
  const strings = sharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8"));
  const dates = dateStyles(files.get("xl/styles.xml")?.toString("utf8"));

  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(attr(rowMatch[0], "r") ?? rows.length + 1);
    const cells: string[] = [];
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = `<c${c[1]}>`;
      const ref = attr(tag, "r");
      const index = ref ? columnIndex(ref) : cells.length;
      const type = attr(tag, "t");
      const body = c[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = strings[Number(v)] ?? "";
      else if (type === "inlineStr") value = itemText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? "");
      else if (type === "str") value = decodeXml(v ?? "");
      else if (type === "b") value = v === "1" ? "1" : "0";
      else if (type === "e") value = "";
      else if (v !== undefined) {
        const style = Number(attr(tag, "s") ?? 0);
        value = dates[style] ? excelSerialToIso(Number(v)) ?? tidyNumber(v) : tidyNumber(v);
      }
      if (index >= 0 && index < 16_384) {
        while (cells.length < index) cells.push("");
        cells[index] = value;
      }
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows[rowNumber - 1] = cells;
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => !c.trim())) rows.pop();
  return rows;
}
