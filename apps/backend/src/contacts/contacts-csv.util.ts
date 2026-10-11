/**
 * Contacts CSV import/export — idea and the "match existing contacts,
 * report created/updated/skipped" flow adapted from faktorio's contact list
 * (https://github.com/capaj/faktorio, MIT © 2024-now Jiri Spac).
 *
 * Import is deliberately forgiving about where the file came from: it
 * accepts our own export, faktorio's export (`name`, `registration_no`,
 * `vat_no`, `main_email`, …), Fakturoid's subject export and plain Czech /
 * Slovak column names typed by hand in Excel. The delimiter (`;`, `,` or
 * tab) and a UTF-8 BOM are auto-detected.
 */

export interface CsvContact {
  legalName: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  internalNote: string | null;
}

export interface CsvSkip {
  line: number;
  reason: "missing_name" | "invalid_ico" | "invalid_email" | "invalid_country";
  name: string;
}

type Field = keyof CsvContact | "street2";

/** Normalised header (lowercase, no diacritics/spaces/punctuation) → field. */
const HEADER_ALIASES: Record<string, Field> = {};
const alias = (field: Field, ...names: string[]) => names.forEach((n) => (HEADER_ALIASES[normalizeHeader(n)] = field));
alias("legalName", "Název", "Nazev", "Firma", "Jméno", "Name", "Company", "Legal name", "legalName", "Obchodní jméno", "Odběratel", "Odberatel", "Názov", "Obchodné meno");
alias("ico", "IČO", "ICO", "IČ", "Registration no", "registration_no", "Company ID", "ico");
alias("dic", "DIČ", "DIC", "VAT no", "vat_no", "VAT ID", "VAT", "IČ DPH", "dic");
alias("email", "E-mail", "Email", "main_email", "Mail", "emails");
alias("addressStreet", "Ulice", "Street", "Adresa", "Address", "addressStreet", "Ulica");
alias("street2", "street2", "Ulice 2", "Address 2");
alias("addressCity", "Město", "Mesto", "Obec", "City", "addressCity");
alias("addressPostalCode", "PSČ", "PSC", "ZIP", "Postal code", "Postcode", "addressPostalCode");
alias("internalNote", "Interní poznámka", "Interni poznamka", "Soukromá poznámka", "Poznámka", "Poznamka", "Note", "Notes", "private_notes", "Internal note", "internalNote");
alias("addressCountry", "Země", "Zeme", "Stát", "Stat", "Krajina", "Country", "Country code", "addressCountry");

const COUNTRY_NAMES: Record<string, string> = {
  "cesko": "CZ", "ceskarepublika": "CZ", "czechia": "CZ", "czechrepublic": "CZ", "cr": "CZ",
  "slovensko": "SK", "slovakia": "SK", "slovenskarepublika": "SK", "sr": "SK",
  "nemecko": "DE", "germany": "DE", "deutschland": "DE",
  "rakousko": "AT", "austria": "AT", "osterreich": "AT",
  "polsko": "PL", "poland": "PL", "polska": "PL",
  "madarsko": "HU", "hungary": "HU",
  "velkabritanie": "GB", "unitedkingdom": "GB", "uk": "GB",
  "usa": "US", "unitedstates": "US", "spojenestaty": "US",
};

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** RFC 4180-ish parser: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(content: string): string[][] {
  const text = content.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ",");

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function count(line: string, ch: string): number {
  return line.split(ch).length - 1;
}

/**
 * Maps parsed CSV rows (first row = header) to contacts. Rows that can't
 * become a valid contact are reported with their 1-based file line instead
 * of failing the whole import. Throws `unknown_columns` when no header
 * matches the name column, i.e. the file is clearly not a contact list.
 */
export function mapContactRows(rows: string[][]): { contacts: { line: number; contact: CsvContact }[]; skipped: CsvSkip[] } {
  const [header, ...body] = rows;
  if (!header) return { contacts: [], skipped: [] };
  const columns = header.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);
  if (!columns.includes("legalName")) throw new Error("unknown_columns");

  const contacts: { line: number; contact: CsvContact }[] = [];
  const skipped: CsvSkip[] = [];
  body.forEach((cells, index) => {
    const line = index + 2;
    const raw: Partial<Record<Field, string>> = {};
    columns.forEach((field, i) => {
      const value = (cells[i] ?? "").trim();
      if (field && value && raw[field] === undefined) raw[field] = value;
    });

    const name = raw.legalName ?? "";
    if (!name) return skipped.push({ line, reason: "missing_name", name: "" });

    const ico = raw.ico ? raw.ico.replace(/\s/g, "") : null;
    const icoPadded = ico && /^\d{1,8}$/.test(ico) ? ico.padStart(8, "0") : ico;
    if (icoPadded && !/^\d{8}$/.test(icoPadded)) return skipped.push({ line, reason: "invalid_ico", name });

    const email = raw.email ? raw.email.split(/[,;\s]+/)[0] : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return skipped.push({ line, reason: "invalid_email", name });

    const country = normalizeCountry(raw.addressCountry);
    if (!country) return skipped.push({ line, reason: "invalid_country", name });

    const street = [raw.addressStreet, raw.street2].filter(Boolean).join(", ") || null;
    contacts.push({
      line,
      contact: {
        legalName: name,
        ico: icoPadded,
        dic: raw.dic ? raw.dic.replace(/\s/g, "").toUpperCase().slice(0, 14) : null,
        email,
        addressStreet: street,
        addressCity: raw.addressCity ?? null,
        addressPostalCode: raw.addressPostalCode ? raw.addressPostalCode.slice(0, 10) : null,
        addressCountry: country,
        internalNote: raw.internalNote ? raw.internalNote.slice(0, 4000) : null,
      },
    });
  });
  return { contacts, skipped };
}

export function normalizeCountry(value: string | undefined): string | null {
  if (!value) return "CZ";
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  return COUNTRY_NAMES[normalizeHeader(value)] ?? null;
}

const EXPORT_HEADER = ["Název", "IČO", "DIČ", "E-mail", "Ulice", "Město", "PSČ", "Země", "Plátce DPH", "Interní poznámka"];

/** Czech-Excel-friendly export (`;`, BOM) whose header round-trips through `mapContactRows`. */
export function contactsToCsv(
  rows: { legalName: string; ico: string | null; dic: string | null; email: string | null; addressStreet: string | null; addressCity: string | null; addressPostalCode: string | null; addressCountry: string; isVatPayer: boolean | null; internalNote?: string | null }[],
): string {
  const cell = (v: string | null | undefined) => {
    const s = v ?? "";
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    EXPORT_HEADER,
    ...rows.map((r) => [
      r.legalName,
      r.ico,
      r.dic,
      r.email,
      r.addressStreet,
      r.addressCity,
      r.addressPostalCode,
      r.addressCountry,
      r.isVatPayer == null ? "" : r.isVatPayer ? "ano" : "ne",
      r.internalNote,
    ]),
  ];
  return "﻿" + lines.map((l) => l.map(cell).join(";")).join("\r\n") + "\r\n";
}

/**
 * Czech Excel's "CSV (oddělený středníkem)" is saved in windows-1250, not
 * UTF-8 — fall back to it when the bytes aren't valid UTF-8.
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1250").decode(buffer);
  }
}
