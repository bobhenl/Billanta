import { normalizeHeader } from "../contacts/contacts-csv.util";
import { fieldForHeader, missingImportFields, type ImportField, type RequiredImportField } from "./invoice-import.util";

/**
 * Which invoicing tool an exported invoice list came from, told by its
 * column names. Most of their names already map through the shared aliases
 * in `invoice-import.util.ts`; a profile adds the names that mean something
 * else in that tool only, and lets the wizard say "looks like an iDoklad
 * export" before anything is imported.
 *
 * The signatures are the columns typical for each tool's list export. They
 * are deliberately loose (a share of them has to be there), since every tool
 * lets people pick and reorder the columns.
 */

export const IMPORT_SOURCES = ["fakturoid", "idoklad", "superfaktura", "vyfakturuj", "kros", "billdu", "bitfaktura"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

interface SourceProfile {
  /** Headers that are typical for this tool's export. */
  signature: string[];
  /** Names this tool uses for something else than the shared alias says. */
  aliases?: Record<string, ImportField>;
}

const PROFILES: Record<ImportSource, SourceProfile> = {
  fakturoid: {
    signature: ["Číslo", "Klient", "IČO klienta", "DIČ klienta", "Vystaveno", "DUZP", "Splatnost", "Celkem bez DPH", "Celkem", "Zaplaceno"],
  },
  idoklad: {
    signature: ["Číslo dokladu", "Odběratel - název", "Odběratel - IČ", "Odběratel - DIČ", "Datum vystavení", "Datum splatnosti", "Celkem DPH", "Celkem s DPH", "Stav úhrady"],
  },
  superfaktura: {
    signature: ["Číslo faktúry", "Odberateľ", "IČ DPH", "Vystavená", "Splatná", "Dátum dodania", "Suma bez DPH", "Suma s DPH", "Variabilný symbol"],
  },
  vyfakturuj: {
    signature: ["Číslo dokladu", "Odběratel", "Odběratel IČ", "Odběratel DIČ", "Datum zdan. plnění", "Cena bez DPH", "Cena s DPH", "Uhrazeno dne", "VS"],
  },
  kros: {
    signature: ["Číslo dokladu", "Dátum vyhotovenia", "Odberateľ - názov", "Odberateľ - IČO", "Odberateľ - IČ DPH", "Základ DPH spolu", "DPH spolu", "Celkom s DPH"],
  },
  billdu: {
    signature: ["Document No.", "Client", "Client ID", "Client Tax ID", "Client VAT ID", "Delivery date", "Total without VAT", "Total"],
    // Billdu's "Client ID" is the company registration number, not an internal id.
    aliases: { [normalizeHeader("Client ID")]: "ico" },
  },
  bitfaktura: {
    signature: ["Number", "Kind", "Sell date", "Payment to", "Buyer name", "Buyer tax no", "Price net", "Price gross"],
  },
};

const SIGNATURES = Object.fromEntries(
  IMPORT_SOURCES.map((s) => [s, new Set(PROFILES[s].signature.map(normalizeHeader))]),
) as Record<ImportSource, Set<string>>;

/** Share of a signature a header must contain to count as that tool's export. */
const MIN_SIGNATURE_SHARE = 0.6;

/** The tool whose export this header looks like most, or null when none fits well enough. */
export function detectImportSource(header: string[]): ImportSource | null {
  const present = new Set(header.map(normalizeHeader));
  let best: { source: ImportSource; share: number } | null = null;
  for (const source of IMPORT_SOURCES) {
    const sig = SIGNATURES[source];
    const hits = [...sig].filter((h) => present.has(h)).length;
    const share = hits / sig.size;
    if (share >= MIN_SIGNATURE_SHARE && (!best || share > best.share)) best = { source, share };
  }
  return best?.source ?? null;
}

/** The guessed field per column, with the source's own names first. */
export function columnsForHeader(header: string[], source: ImportSource | null): (ImportField | null)[] {
  const extra = source ? PROFILES[source].aliases : undefined;
  const seen = new Set<ImportField>();
  return header.map((h) => {
    const field = fieldForHeader(h, extra);
    // Two columns guessed as the same field: the first one wins, as when reading rows.
    if (!field || seen.has(field)) return null;
    seen.add(field);
    return field;
  });
}

export interface ImportColumn {
  header: string;
  field: ImportField | null;
  /** First non-empty values below the header, so the user can tell what a column holds. */
  samples: string[];
}

/** What the mapping editor shows: each column, its field and a few values. */
export function describeColumns(rows: string[][], columns: (ImportField | null)[]): ImportColumn[] {
  const [header = [], ...body] = rows;
  return header.map((h, i) => ({
    header: h.trim().slice(0, 80),
    field: columns[i] ?? null,
    samples: body
      .map((r) => (r[i] ?? "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((v) => v.slice(0, 60)),
  }));
}

export interface ImportPlan {
  source: ImportSource | null;
  columns: (ImportField | null)[];
  missing: RequiredImportField[];
}

/**
 * How a file will be read: the detected source and the field per column,
 * or the user's own mapping (one entry per column; extra ones ignored).
 */
export function planImport(rows: string[][], mapping?: (ImportField | null)[] | null): ImportPlan {
  const header = rows[0] ?? [];
  const source = detectImportSource(header);
  const columns = mapping ? header.map((_, i) => mapping[i] ?? null) : columnsForHeader(header, source);
  return { source, columns, missing: missingImportFields(columns) };
}
