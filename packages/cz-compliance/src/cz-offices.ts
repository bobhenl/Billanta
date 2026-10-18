/**
 * Which finanční úřad, územní pracoviště and OSSZ a Czech address belongs
 * to, for prefilling the yearly DPFO (DPFDP7 `c_ufo_cil`, `c_pracufo`) and
 * ČSSZ přehled (`dep`). The table itself is generated from the official
 * code lists by `scripts/build-cz-offices.mjs` (sources are listed there)
 * and shipped as `apps/frontend/data/cz-offices.json`.
 *
 * PSČ is the key because it is what people type reliably; where one PSČ
 * spans several offices the obec name decides. Anything still ambiguous
 * comes back as null, since a wrong office in a tax return is worse than
 * an empty field the user fills in.
 */

/** [kód FÚ, kód územního pracoviště, kód OSSZ]; 0 = not known. */
export type CzOfficeCodes = readonly [number, number, number];

export interface CzOfficeTable {
  offices: readonly CzOfficeCodes[];
  /** PSČ -> office index, or obec name -> index with '*' as the fallback. */
  psc: Record<string, number | Record<string, number>>;
}

export interface CzOffices {
  taxOffice: number | null;
  taxWorkplace: number | null;
  ossz: string | null;
}

/** Same normalisation the generator uses for obec names. */
export function normalizeObec(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lookupCzOffices(table: CzOfficeTable, postalCode?: string | null, city?: string | null): CzOffices | null {
  const psc = (postalCode ?? '').replace(/\s+/g, '');
  const entry = /^\d{5}$/.test(psc) ? table.psc[psc] : undefined;
  if (entry == null) return null;
  let index: number | undefined;
  if (typeof entry === 'number') index = entry;
  else {
    const name = normalizeObec(city ?? '');
    // "Brno, Židenice", "Brno-Židenice (Brno-město)", "Praha 4-Nusle": the
    // whole name first, then shorter forms, then what all offices agree on.
    const bracketless = name.split(/[(,]/)[0]!.trim();
    const candidates = [name, name.replace(/\s*,\s*/g, '-'), bracketless, bracketless.split(/-(?=\D)/)[0]!.trim()];
    index = candidates.map((c) => (c ? entry[c] : undefined)).find((i) => i != null) ?? entry['*'];
  }
  const codes = index == null ? undefined : table.offices[index];
  if (!codes) return null;
  const [ufo, prac, ossz] = codes;
  return { taxOffice: ufo || null, taxWorkplace: prac || null, ossz: ossz ? String(ossz) : null };
}
