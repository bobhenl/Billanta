/**
 * Slovak register of legal entities (RPO, Štatistický úrad SR) — the SK
 * counterpart of ARES. Idea from faktorio (MIT, © Jiri Spac).
 *
 * Data © ŠÚ SR, published under CC BY 4.0.
 */
const RPO_URL = 'https://api.statistics.sk/rpo/v1/search';

interface RpoValued {
  value: string;
  validFrom?: string;
  validTo?: string;
}

interface RpoAddress {
  validFrom?: string;
  validTo?: string;
  street?: string;
  regNumber?: number;
  buildingNumber?: string;
  postalCodes?: string[];
  municipality?: { value?: string };
  country?: { value?: string; code?: string };
}

interface RpoResult {
  id: number;
  identifiers?: RpoValued[];
  fullNames?: RpoValued[];
  addresses?: RpoAddress[];
  termination?: string;
}

export interface RpoSubject {
  ico: string;
  name: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** Date the entity ceased to exist, if it did. */
  terminatedAt: string | null;
}

export class RpoApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RpoApiError';
  }
}

const current = <T extends { validTo?: string }>(list: T[] | undefined): T | undefined =>
  list?.find((x) => !x.validTo) ?? list?.[list.length - 1];

export function mapRpoResult(r: RpoResult): RpoSubject | null {
  const ico = current(r.identifiers)?.value;
  const name = current(r.fullNames)?.value;
  if (!ico || !name) return null;
  const a = current(r.addresses);
  const number = [a?.regNumber ? String(a.regNumber) : '', a?.buildingNumber ?? ''].filter(Boolean).join('/');
  const street = a ? [a.street ?? a.municipality?.value, number].filter(Boolean).join(' ') || null : null;
  return {
    ico: ico.padStart(8, '0'),
    name,
    street,
    city: a?.municipality?.value ?? null,
    postalCode: a?.postalCodes?.[0]?.replace(/\s/g, '') ?? null,
    terminatedAt: r.termination ?? null,
  };
}

async function query(params: Record<string, string>, timeoutMs: number): Promise<RpoSubject[]> {
  const url = `${RPO_URL}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new RpoApiError(`RPO request failed: ${(err as Error).message}`);
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new RpoApiError(`RPO responded ${res.status}`, res.status);
  const body = (await res.json()) as { results?: RpoResult[] };
  return (body.results ?? []).map(mapRpoResult).filter((s): s is RpoSubject => s !== null);
}

/** Looks up a Slovak company by IČO; null when RPO does not know it. */
export async function getRpoSubjectByIco(ico: string, opts: { timeoutMs?: number } = {}): Promise<RpoSubject | null> {
  if (!/^\d{6,8}$/.test(ico)) return null;
  const [hit] = await query({ identifier: ico }, opts.timeoutMs ?? 8000);
  return hit ?? null;
}

/** Lowercase, no diacritics, single spaces: "Pošta  a.s." and "posta a.s." fold the same (the local SK index stores this). */
export const foldCompanyName = (s: string): string =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Keeps the hits whose current name contains `query`, names that start with
 * it first, then shorter (closer) names, one hit per IČO. The live RPO
 * search and the local index (apps/backend sk-companies) both rank through
 * this, so switching between them does not reorder the typeahead.
 */
export function rankByName<T extends { ico: string; name: string }>(hits: T[], query: string, limit: number): T[] {
  const needle = foldCompanyName(query);
  if (!needle) return [];
  const matching = hits.map((h) => ({ h, f: foldCompanyName(h.name) })).filter((x) => x.f.includes(needle));
  matching.sort((a, b) => Number(!a.f.startsWith(needle)) - Number(!b.f.startsWith(needle)) || a.h.name.length - b.h.name.length);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const { h } of matching) {
    if (seen.has(h.ico)) continue;
    seen.add(h.ico);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}

/** Slovak companies whose name contains `name` (active ones only). */
export async function searchRpoSubjects(name: string, opts: { timeoutMs?: number; limit?: number } = {}): Promise<RpoSubject[]> {
  const q = name.trim();
  if (q.length < 3) return [];
  // RPO also matches former names; rankByName keeps subjects whose *current* name matches.
  const hits = (await query({ fullName: q }, opts.timeoutMs ?? 8000)).filter((h) => !h.terminatedAt);
  return rankByName(hits, q, opts.limit ?? 6);
}
