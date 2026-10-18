/**
 * Slovak register of financial statements (Register účtovných závierok,
 * MF SR), open API: https://www.registeruz.sk/cruz-public/home/api
 *
 * Used for one thing: a Slovak company by IČO, fast. RPO answers our VPS in
 * several seconds, RÚZ in about 0.1 s per call, and RÚZ also has the DIČ,
 * which RPO does not publish. It covers sole traders too (the units come from
 * ŠÚ SR, `zdrojDat: "SUSR"`), but it lags RPO by weeks to months, so a
 * company that was just founded or dissolved can be missing or out of date.
 * There is no name search. Data under CC0.
 */
const RUZ_URL = 'https://www.registeruz.sk/cruz-public/api';

/** One `uctovna-jednotka` detail; null attributes are left out by the API. */
export interface RuzUnit {
  id: number;
  ico?: string;
  dic?: string;
  nazovUJ?: string;
  ulica?: string;
  mesto?: string;
  psc?: string;
  pravnaForma?: string;
  datumZalozenia?: string;
  datumZrusenia?: string;
  datumPoslednejUpravy?: string;
  /** "ZMAZANÉ" (deleted) or "Neverejná" (moved out of the public part); only id and dates come with it. */
  stav?: string;
}

export interface RuzSubject {
  ico: string;
  dic: string | null;
  name: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** ŠÚ SR legal form code, e.g. "112" s.r.o., "101" sole trader. */
  legalForm: string | null;
  terminatedAt: string | null;
  updatedAt: string | null;
}

export class RuzApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'RuzApiError';
  }
}

export function mapRuzUnit(u: RuzUnit): RuzSubject | null {
  if (u.stav || !u.ico || !u.nazovUJ) return null;
  return {
    ico: u.ico.padStart(8, '0'),
    dic: u.dic && /^\d{10}$/.test(u.dic) ? u.dic : null,
    name: u.nazovUJ,
    street: u.ulica || null,
    city: u.mesto || null,
    postalCode: u.psc?.replace(/\s/g, '') || null,
    legalForm: u.pravnaForma ?? null,
    terminatedAt: u.datumZrusenia ?? null,
    updatedAt: u.datumPoslednejUpravy ?? null,
  };
}

/**
 * One IČO can have several units (a company re-registered, an old deleted
 * duplicate). The live one wins, then the most recently updated.
 */
export function pickRuzSubject(subjects: (RuzSubject | null)[], ico: string): RuzSubject | null {
  const want = ico.padStart(8, '0');
  const live = subjects.filter((s): s is RuzSubject => s !== null && s.ico === want);
  live.sort((a, b) => Number(!!a.terminatedAt) - Number(!!b.terminatedAt) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return live[0] ?? null;
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RUZ_URL}/${path}`, { headers: { accept: 'application/json' }, signal });
  } catch (err) {
    throw new RuzApiError(`RÚZ request failed: ${(err as Error).message}`);
  }
  if (!res.ok) throw new RuzApiError(`RÚZ responded ${res.status}`, res.status);
  return (await res.json()) as T;
}

/**
 * A Slovak company by IČO from RÚZ; null when RÚZ has no live unit for it
 * (unknown, deleted or dissolved). An outage throws `RuzApiError`.
 */
export async function getRuzSubjectByIco(ico: string, opts: { timeoutMs?: number } = {}): Promise<RuzSubject | null> {
  if (!/^\d{6,8}$/.test(ico)) return null;
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 4000);
  // `zmenene-od` is mandatory; a date before the register existed lists every unit with this IČO.
  const list = await getJson<{ id?: number[] }>(`uctovne-jednotky?zmenene-od=2000-01-01&ico=${ico.padStart(8, '0')}`, signal);
  const ids = (list.id ?? []).slice(-5);
  if (ids.length === 0) return null;
  const units = await Promise.all(ids.map((id) => getJson<RuzUnit>(`uctovna-jednotka?id=${id}`, signal)));
  const subject = pickRuzSubject(units.map(mapRuzUnit), ico);
  return subject && !subject.terminatedAt ? subject : null;
}
