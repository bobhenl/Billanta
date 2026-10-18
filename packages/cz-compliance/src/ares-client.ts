/**
 * ARES (Administrativní registr ekonomických subjektů) client.
 *
 * ARES is the Czech public business registry REST API operated by the Ministry
 * of Finance. This module is a thin, pure HTTP wrapper around it — it performs
 * no caching (caching/throttling lives in the consuming backend's Redis layer,
 * see blueprint §1 "Known gaps" — ARES has no documented rate limit, so callers
 * must defensively cache + throttle) and holds no state of its own.
 *
 * Docs / OpenAPI spec: https://ares.gov.cz/swagger-ui/
 *
 * NOTE on field names: the shape below is a best-effort mapping based on the
 * publicly documented ARES v3 REST schema (`EkonomickySubjektVBR` /
 * `EkonomickySubjekt` types). It was not verified against a live API response
 * during this scaffold — before relying on this in production, fire a real
 * request against a known IČO (e.g. `getSubjectByIco('00006947')`, the Czech
 * Ministry of Finance's own IČO) and diff the actual JSON against `AresSubject`
 * below, adjusting field names/optionality as needed. This is also where the
 * blueprint's open question ("does ARES expose plátce DPH / VAT-payer status
 * directly?") should be resolved — the `dic` presence alone does not imply
 * VAT-payer status; a dedicated ADISREG check may still be required.
 */

const ARES_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';
/** ARES answers in well under a second when healthy; a hung request must not hold a typeahead or a form. */
const ARES_TIMEOUT_MS = 8000;

/** Postal/registered-seat address of a subject, as returned by ARES ("sidlo"). */
export interface AresAddress {
  /** Full formatted single-line address, e.g. "Letenská 525/15, Malá Strana, 118 00 Praha 1". */
  textovaAdresa?: string;
  /** Name of the region ("kraj"). */
  nazevKraje?: string;
  /** Name of the district ("okres"). */
  nazevOkresu?: string;
  /** Name of the municipality ("obec"). */
  nazevObce?: string;
  /** Name of the municipality part / city district, if applicable. */
  nazevCastiObce?: string;
  /** Street name. */
  nazevUlice?: string;
  /** Street/registration (house) number ("číslo domovní"). */
  cisloDomovni?: number;
  /** Orientation number ("číslo orientační"), e.g. the "15" in "525/15". */
  cisloOrientacni?: number;
  /** Orientation number letter suffix, if any (e.g. "a" in "15a"). */
  cisloOrientacniPismeno?: string;
  /** Postal code (PSČ), digits only, no space — e.g. 11800. */
  psc?: number;
  /** ISO 3166-1 alpha-2 country code, e.g. "CZ". */
  kodStatu?: string;
  /** Country name, e.g. "Česká republika". */
  nazevStatu?: string;
}

/** Legal form code + description ("právní forma"), per the ARES / ČSÚ RES codelist. */
export interface AresLegalForm {
  /** Numeric codelist value, e.g. 112 = "Společnost s ručením omezeným" (s.r.o.). */
  kod?: string;
  nazev?: string;
}

/**
 * A single economic subject as returned by ARES.
 *
 * Corresponds to the `EkonomickySubjekt` response of
 * `GET /ekonomicke-subjekty/{ico}`. Field names mirror the Czech-language JSON
 * keys ARES actually returns (it is not translated/localized).
 */
export interface AresSubject {
  /** IČO — 8-digit organization identifier (may have leading zeros). */
  ico: string;
  /** DIČ — VAT identification number, e.g. "CZ00006947". Absent if not VAT-registered. */
  dic?: string;
  /** Registered legal/trade name ("obchodní jméno"). */
  obchodniJmeno: string;
  /** Registered seat / address. */
  sidlo?: AresAddress;
  /** Legal form (s.r.o., a.s., OSVČ, ...). */
  pravniForma?: AresLegalForm;
  /** Date the subject was registered/established (ISO 8601 date string, "YYYY-MM-DD"). */
  datumVzniku?: string;
  /** Date the subject ceased to exist, if applicable. */
  datumZaniku?: string;
  /**
   * Best-effort, NOT authoritative: some ARES source-registry blocks (e.g. the
   * VR/RES extract) surface a "plátce DPH" flag; per the blueprint's flagged
   * open question this is not confirmed to be present on the base subject
   * response. Treat `undefined` as "unknown", never as "false".
   */
  platceDph?: boolean;
  /** Raw list of source registries ARES aggregated this record from (diagnostic use only). */
  seznamRegistraci?: Record<string, unknown>;
}

/** Raw ARES search request body for `POST /ekonomicke-subjekty/vyhledat`. */
interface AresSearchRequest {
  obchodniJmeno?: string;
  pocet?: number;
  start?: number;
}

/** Raw ARES search response envelope. */
interface AresSearchResponse {
  ekonomickeSubjekty?: AresSubject[];
  pocetCelkem?: number;
}

export class AresApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
  ) {
    super(message);
    this.name = 'AresApiError';
  }
}

/**
 * Look up a single economic subject by IČO.
 *
 * @param ico 8-digit Czech organization identifier. Whitespace is trimmed; the
 *   value is otherwise passed through as-is (ARES accepts it without leading
 *   zeros stripped).
 * @returns The matching subject, or `null` if ARES returns 404 (no such IČO).
 * @throws {AresApiError} for any other non-2xx response.
 */
export async function getSubjectByIco(ico: string): Promise<AresSubject | null> {
  const normalizedIco = ico.trim();
  const url = `${ARES_BASE_URL}/${encodeURIComponent(normalizedIco)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(ARES_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new AresApiError(
      `ARES lookup for IČO "${normalizedIco}" failed with status ${response.status}`,
      response.status,
      url,
    );
  }

  return (await response.json()) as AresSubject;
}

/**
 * Search for economic subjects by (partial) legal/trade name.
 *
 * @param name Free-text business name to search for.
 * @param options.limit Max number of results to request from ARES (default 20).
 * @returns Array of matching subjects (empty array if none found).
 * @throws {AresApiError} for any non-2xx response.
 */
export async function searchSubjects(
  name: string,
  options: { limit?: number } = {},
): Promise<AresSubject[]> {
  const url = `${ARES_BASE_URL}/vyhledat`;
  const body: AresSearchRequest = {
    obchodniJmeno: name.trim(),
    pocet: options.limit ?? 20,
    start: 0,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ARES_TIMEOUT_MS),
  });

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new AresApiError(
      `ARES search for name "${name}" failed with status ${response.status}`,
      response.status,
      url,
    );
  }

  const data = (await response.json()) as AresSearchResponse;
  return data.ekonomickeSubjekty ?? [];
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Typeahead-friendly name search. ARES only matches whole words ("tom vejm"
 * finds nothing, "Tom Vejmelka" does), so when the exact query is empty and the
 * last word looks unfinished, ask ARES for the finished words only and keep the
 * subjects that have a word starting with the unfinished one.
 */
export async function searchSubjectsTypeahead(
  name: string,
  options: { limit?: number } = {},
): Promise<AresSubject[]> {
  const limit = options.limit ?? 20;
  const exact = await searchSubjects(name, { limit });
  if (exact.length) return exact;

  const words = name.trim().split(/\s+/);
  const partial = fold(words.pop() ?? '');
  if (!words.length || partial.length < 2) return [];
  const pool = await searchSubjects(words.join(' '), { limit: 1000 });
  return pool
    .filter((s) => fold(s.obchodniJmeno).split(/[\s,.()-]+/).some((w) => w.startsWith(partial)))
    .slice(0, limit);
}

/** One RÚIAN address from ARES `standardizovane-adresy/vyhledat`. */
export interface AresStandardAddress {
  street: string;
  city: string;
  postalCode: string;
  /** e.g. "Jankovcova 1522/53, Holešovice, 17000 Praha 7" */
  label: string;
}

interface AresStandardAddressRaw {
  nazevUlice?: string;
  nazevCastiObce?: string;
  nazevObce?: string;
  nazevMestskeCastiObvodu?: string;
  cisloDomovni?: number;
  cisloOrientacni?: number;
  cisloOrientacniPismeno?: string;
  typCisloDomovni?: number;
  psc?: number;
  textovaAdresa?: string;
}

/**
 * Address typeahead over the Czech address register (RÚIAN via ARES).
 * Free text such as "Jankovcova 15" or "Jankovcova, 17000". Too broad a
 * query (> 1000 matches, e.g. a bare PSČ) comes back as an empty list.
 */
export async function searchAddresses(text: string, options: { limit?: number } = {}): Promise<AresStandardAddress[]> {
  const url = `${ARES_BASE_URL.replace(/\/ekonomicke-subjekty$/, '')}/standardizovane-adresy/vyhledat`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify({ textovaAdresa: text.trim(), pocet: options.limit ?? 8, typStandardizaceAdresy: 'VYHOVUJICI_ADRESY' }),
    signal: AbortSignal.timeout(ARES_TIMEOUT_MS),
  });
  if (response.status === 400 || response.status === 404) return [];
  if (!response.ok) throw new AresApiError(`ARES address search failed with status ${response.status}`, response.status, url);
  const data = (await response.json()) as { standardizovaneAdresy?: AresStandardAddressRaw[] };
  return (data.standardizovaneAdresy ?? []).map((a) => {
    const number =
      a.cisloDomovni != null
        ? `${a.typCisloDomovni === 2 ? 'č. ev. ' : ''}${a.cisloDomovni}${a.cisloOrientacni != null ? `/${a.cisloOrientacni}${a.cisloOrientacniPismeno ?? ''}` : ''}`
        : '';
    const streetName = a.nazevUlice || a.nazevCastiObce || a.nazevObce || '';
    const psc = a.psc != null ? String(a.psc).padStart(5, '0') : '';
    return {
      street: [streetName, number].filter(Boolean).join(' '),
      city: a.nazevMestskeCastiObvodu && a.nazevObce === 'Praha' ? a.nazevMestskeCastiObvodu : a.nazevObce ?? '',
      postalCode: psc,
      label: a.textovaAdresa ?? '',
    };
  });
}
