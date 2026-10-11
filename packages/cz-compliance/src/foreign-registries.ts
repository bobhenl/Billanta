/**
 * Free, key-less company registers outside CZ/SK, normalised to one shape:
 *
 * - FR — recherche-entreprises.api.gouv.fr (name or SIREN; Etalab open licence)
 * - NO — data.brreg.no Enhetsregisteret (name or org. number; NLOD)
 * - PL — Biała lista podatników VAT, wl-api.mf.gov.pl (NIP)
 * - EU — VIES (any EU VAT number, e.g. IT00488410010; some states such as DE
 *   confirm validity only and return no name/address)
 * - World — GLEIF LEI records (api.gleif.org, CC0): only legal entities that
 *   hold an LEI, i.e. mostly larger companies, but in ~200 countries (US, DE …)
 * - GB — Companies House, needs a free API key (COMPANIES_HOUSE_API_KEY)
 * - FI — PRH / YTJ open data (avoindata.prh.fi; name or Y-tunnus; CC BY 4.0)
 * - DK — cvrapi.dk (name or CVR; free tier, best match only)
 * - CH — UID register public web service (uid-wse.admin.ch; name or CHE number)
 */

export interface RegistryHit {
  registry: 'FR' | 'NO' | 'PL' | 'VIES' | 'GLEIF' | 'GB' | 'FI' | 'DK' | 'CH';
  /** National registration number (SIREN, org.nr, NIP …), when the register has one. */
  regNumber: string | null;
  vatId: string | null;
  name: string;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2 */
  country: string;
  isVatPayer: boolean | null;
}

const TIMEOUT_MS = 8000;

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return (await res.json()) as T;
}

const titleCase = (s: string | null | undefined): string | null =>
  s ? s.toLowerCase().replace(/(^|[\s\-'/])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()) : null;

/** French intra-community VAT number from a SIREN. */
export function frenchVatFromSiren(siren: string): string {
  const key = (12 + 3 * (Number(siren) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${siren}`;
}

// ---------------------------------------------------------------- FR

interface FrResult {
  siren: string;
  nom_complet: string;
  etat_administratif?: string;
  siege?: {
    numero_voie?: string | null;
    type_voie?: string | null;
    libelle_voie?: string | null;
    code_postal?: string | null;
    libelle_commune?: string | null;
  };
}

const FR_STREET_TYPES: Record<string, string> = {
  RUE: 'rue',
  AV: 'avenue',
  BD: 'boulevard',
  PL: 'place',
  CHE: 'chemin',
  ALL: 'allée',
  IMP: 'impasse',
  RTE: 'route',
  QUA: 'quai',
};

export async function searchFrance(q: string, limit = 6): Promise<RegistryHit[]> {
  const params = new URLSearchParams({ q: q.trim(), per_page: String(limit) });
  const data = await getJson<{ results?: FrResult[] }>(`https://recherche-entreprises.api.gouv.fr/search?${params}`);
  return (data?.results ?? [])
    .filter((r) => r.etat_administratif !== 'C')
    .map((r) => {
      const s = r.siege ?? {};
      const type = s.type_voie ? (FR_STREET_TYPES[s.type_voie] ?? s.type_voie.toLowerCase()) : '';
      const street = [s.numero_voie, type, titleCase(s.libelle_voie)].filter(Boolean).join(' ') || null;
      return {
        registry: 'FR' as const,
        regNumber: r.siren,
        vatId: frenchVatFromSiren(r.siren),
        name: r.nom_complet,
        street,
        city: titleCase(s.libelle_commune),
        postalCode: s.code_postal ?? null,
        country: 'FR',
        isVatPayer: null,
      };
    });
}

// ---------------------------------------------------------------- NO

interface NoUnit {
  organisasjonsnummer: string;
  navn: string;
  registrertIMvaregisteret?: boolean;
  konkurs?: boolean;
  forretningsadresse?: { adresse?: string[]; postnummer?: string; poststed?: string; landkode?: string };
}

const mapNo = (u: NoUnit): RegistryHit => ({
  registry: 'NO',
  regNumber: u.organisasjonsnummer,
  vatId: u.registrertIMvaregisteret ? `NO${u.organisasjonsnummer}MVA` : null,
  name: u.navn,
  street: u.forretningsadresse?.adresse?.filter(Boolean).join(', ') || null,
  city: titleCase(u.forretningsadresse?.poststed),
  postalCode: u.forretningsadresse?.postnummer ?? null,
  country: u.forretningsadresse?.landkode ?? 'NO',
  isVatPayer: u.registrertIMvaregisteret ?? null,
});

export async function searchNorway(q: string, limit = 6): Promise<RegistryHit[]> {
  const digits = q.replace(/\s/g, '');
  if (/^\d{9}$/.test(digits)) {
    const unit = await getJson<NoUnit>(`https://data.brreg.no/enhetsregisteret/api/enheter/${digits}`);
    return unit ? [mapNo(unit)] : [];
  }
  const params = new URLSearchParams({ navn: q.trim(), size: String(limit) });
  const data = await getJson<{ _embedded?: { enheter?: NoUnit[] } }>(`https://data.brreg.no/enhetsregisteret/api/enheter?${params}`);
  return (data?._embedded?.enheter ?? []).filter((u) => !u.konkurs).map(mapNo);
}

// ---------------------------------------------------------------- PL

interface PlSubject {
  name: string;
  nip: string;
  statusVat?: string;
  workingAddress?: string | null;
  residenceAddress?: string | null;
}

/** Polish VAT white list — by NIP (10 digits) only. */
export async function lookupPoland(nip: string): Promise<RegistryHit[]> {
  const digits = nip.replace(/[\s-]/g, '').replace(/^PL/i, '');
  if (!/^\d{10}$/.test(digits)) return [];
  const today = new Date().toISOString().slice(0, 10);
  const data = await getJson<{ result?: { subject?: PlSubject | null } }>(`https://wl-api.mf.gov.pl/api/search/nip/${digits}?date=${today}`);
  const s = data?.result?.subject;
  if (!s) return [];
  // e.g. "ALEJE JEROZOLIMSKIE 160, 02-326 WARSZAWA"
  const address = s.workingAddress ?? s.residenceAddress ?? '';
  const m = address.match(/^(.*),\s*(\d{2}-\d{3})\s+(.+)$/);
  return [
    {
      registry: 'PL',
      regNumber: s.nip,
      vatId: `PL${s.nip}`,
      name: s.name,
      street: titleCase(m ? m[1] : address),
      city: titleCase(m?.[3]),
      postalCode: m?.[2] ?? null,
      country: 'PL',
      isVatPayer: s.statusVat ? s.statusVat === 'Czynny' : null,
    },
  ];
}

// ---------------------------------------------------------------- VIES

export const VIES_COUNTRIES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU',
  'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
] as const;

/** Splits "IT 00488410010" / "it00488410010" into a VIES country + number, or null. */
export function parseVatId(input: string): { country: string; number: string } | null {
  const v = input.replace(/[\s.-]/g, '').toUpperCase();
  const m = v.match(/^([A-Z]{2})([0-9A-Z+*]{2,13})$/);
  if (!m || !/\d/.test(m[2]!)) return null;
  const country = m[1] === 'GR' ? 'EL' : m[1]!;
  return (VIES_COUNTRIES as readonly string[]).includes(country) ? { country, number: m[2]! } : null;
}

/** Validates an EU VAT number; returns the trader name/address where the member state shares it. */
export async function lookupVies(vatId: string): Promise<RegistryHit[]> {
  const parsed = parseVatId(vatId);
  if (!parsed) return [];
  const data = await getJson<{ isValid?: boolean; name?: string; address?: string }>(
    `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${parsed.country}/vat/${encodeURIComponent(parsed.number)}`,
  );
  if (!data?.isValid) return [];
  const name = data.name && data.name !== '---' ? data.name.trim() : '';
  const lines = (data.address && data.address !== '---' ? data.address : '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.length > 1 ? lines[lines.length - 1]! : '';
  const pc = last.match(/^([A-Z]{0,2}-?\d[\d\s-]{2,8})\s+(\D.+)$/);
  const country = parsed.country === 'EL' ? 'GR' : parsed.country === 'XI' ? 'GB' : parsed.country;
  return [
    {
      registry: 'VIES',
      regNumber: null,
      vatId: `${parsed.country}${parsed.number}`,
      name: titleCase(name) ?? '',
      street: titleCase(lines.length > 1 ? lines.slice(0, -1).join(', ') : lines[0]),
      city: titleCase(pc ? pc[2] : last || null),
      postalCode: pc ? pc[1]!.trim() : null,
      country,
      isVatPayer: true,
    },
  ];
}

// ---------------------------------------------------------------- GLEIF (world)

interface GleifRecord {
  attributes: {
    lei: string;
    entity: {
      legalName: { name: string };
      registeredAs?: string | null;
      legalAddress: { addressLines?: string[]; city?: string | null; postalCode?: string | null; country: string };
    };
  };
}

/** Title-cases text only when a register shouts it ("TESCO HOUSE" → "Tesco House"). */
const calm = (s: string | null | undefined): string | null => (s && s === s.toUpperCase() ? titleCase(s) : (s ?? null));

/**
 * Companies by name in the global LEI index, optionally in one country.
 * Addresses come without "c/o" lines; `regNumber` is the local register
 * number GLEIF has on file (e.g. a UK company number).
 */
export async function searchGleif(q: string, country?: string | null, limit = 6): Promise<RegistryHit[]> {
  const params = new URLSearchParams({
    'filter[entity.legalName]': q.trim(),
    'filter[entity.status]': 'ACTIVE',
    'page[size]': String(limit),
  });
  if (country) params.set('filter[entity.legalAddress.country]', country.toUpperCase());
  const data = await getJson<{ data?: GleifRecord[] }>(`https://api.gleif.org/api/v1/lei-records?${params}`, {
    accept: 'application/vnd.api+json',
  });
  return (data?.data ?? []).map(({ attributes: { entity: e } }) => {
    const lines = (e.legalAddress.addressLines ?? []).filter((l) => l && !/^c\/o\b/i.test(l.trim()) && !/^n\.?a\.?$/i.test(l.trim()));
    return {
      registry: 'GLEIF' as const,
      regNumber: e.registeredAs ?? null,
      vatId: null,
      name: e.legalName.name,
      street: calm(lines.join(', ')) || null,
      city: calm(e.legalAddress.city),
      postalCode: e.legalAddress.postalCode ?? null,
      country: e.legalAddress.country,
      isVatPayer: null,
    };
  });
}

// ---------------------------------------------------------------- GB

interface ChItem {
  company_number: string;
  title: string;
  company_status?: string;
  address?: { premises?: string; address_line_1?: string; address_line_2?: string; locality?: string; postal_code?: string };
}

/**
 * UK Companies House search (name or company number). Needs a free key from
 * developer.company-information.service.gov.uk; without one this returns null
 * so the caller can fall back to GLEIF.
 */
export async function searchCompaniesHouse(q: string, apiKey: string | undefined, limit = 6): Promise<RegistryHit[] | null> {
  if (!apiKey) return null;
  const params = new URLSearchParams({ q: q.trim(), items_per_page: String(limit) });
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  const data = await getJson<{ items?: ChItem[] }>(`https://api.company-information.service.gov.uk/search/companies?${params}`, {
    authorization: auth,
  });
  return (data?.items ?? [])
    .filter((i) => i.company_status !== 'dissolved')
    .map((i) => ({
      registry: 'GB' as const,
      regNumber: i.company_number,
      vatId: null,
      name: i.title,
      street: [[i.address?.premises, i.address?.address_line_1].filter(Boolean).join(' '), i.address?.address_line_2].filter(Boolean).join(', ') || null,
      city: i.address?.locality ?? null,
      postalCode: i.address?.postal_code ?? null,
      country: 'GB',
      isVatPayer: null,
    }));
}

// ---------------------------------------------------------------- addresses

interface PhotonFeature {
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    city?: string;
    district?: string;
    countrycode?: string;
    type?: string;
  };
}

export interface WorldAddress {
  street: string;
  city: string;
  postalCode: string;
  country: string;
  label: string;
}

/**
 * Address typeahead for countries without an official register we can use,
 * via Photon (OpenStreetMap data, ODbL; public instance photon.komoot.io).
 */
export async function searchWorldAddresses(q: string, country?: string | null, limit = 8): Promise<WorldAddress[]> {
  const params = new URLSearchParams({ q: q.trim(), limit: String(limit * 2), lang: 'en' });
  const data = await getJson<{ features?: PhotonFeature[] }>(`https://photon.komoot.io/api/?${params}`);
  const cc = country?.toUpperCase();
  const seen = new Set<string>();
  const out: WorldAddress[] = [];
  for (const f of data?.features ?? []) {
    const p = f.properties;
    if (cc && p.countrycode?.toUpperCase() !== cc) continue;
    const streetName = p.street ?? (p.type === 'street' ? p.name : undefined);
    if (!streetName) continue;
    const street = [streetName, p.housenumber].filter(Boolean).join(' ');
    const city = p.city ?? p.district ?? '';
    const label = [street, [p.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ street, city, postalCode: p.postcode ?? '', country: p.countrycode?.toUpperCase() ?? '', label });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------- FI

interface FiCompany {
  businessId: { value: string };
  names?: { name: string; type: string; endDate?: string | null }[];
  addresses?: { type: number; street?: string; buildingNumber?: string; postCode?: string; postOffices?: { city: string; languageCode: string }[] }[];
  registeredEntries?: { register: string; endDate?: string | null }[];
  endDate?: string | null;
}

/** Finnish trade register (PRH/YTJ). Y-tunnus "1234567-8" looks up one company, anything else searches names. */
export async function searchFinland(q: string, limit = 6): Promise<RegistryHit[]> {
  const id = q.trim().replace(/^FI/i, '');
  const byId = /^\d{7}-?\d$/.test(id);
  const params = byId ? `businessId=${id.length === 8 ? `${id.slice(0, 7)}-${id.slice(7)}` : id}` : `name=${encodeURIComponent(q.trim())}`;
  const data = await getJson<{ companies?: FiCompany[] }>(`https://avoindata.prh.fi/opendata-ytj-api/v3/companies?${params}`);
  const needle = q.trim().toLowerCase();
  const nameOf = (c: FiCompany) => c.names?.find((n) => n.type === '1' && !n.endDate)?.name ?? c.names?.[0]?.name ?? c.businessId.value;
  // The name search is fuzzy (any word match); put names that start with / contain the query first.
  const rank = (c: FiCompany) => {
    const n = nameOf(c).toLowerCase();
    return n.startsWith(needle) ? 0 : n.includes(needle) ? 1 : 2;
  };
  return (data?.companies ?? [])
    .filter((c) => !c.endDate)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
    .map((c) => {
      const name = nameOf(c);
      const a = c.addresses?.find((x) => x.type === 1) ?? c.addresses?.[0];
      const vat = c.registeredEntries?.some((e) => e.register === '5' && !e.endDate) ?? false;
      const city = a?.postOffices?.find((o) => o.languageCode === '1')?.city ?? a?.postOffices?.[0]?.city;
      return {
        registry: 'FI' as const,
        regNumber: c.businessId.value,
        vatId: vat ? `FI${c.businessId.value.replace('-', '')}` : null,
        name,
        street: a?.street ? [a.street, a.buildingNumber].filter(Boolean).join(' ') : null,
        city: calm(city),
        postalCode: a?.postCode ?? null,
        country: 'FI',
        isVatPayer: vat,
      };
    });
}

// ---------------------------------------------------------------- DK

interface DkCompany {
  vat?: number;
  name?: string;
  address?: string;
  zipcode?: string;
  city?: string;
  enddate?: string | null;
  error?: string;
}

/** Danish CVR via cvrapi.dk — returns the single best match for a name or CVR number. */
export async function searchDenmark(q: string): Promise<RegistryHit[]> {
  const term = q.trim().replace(/^DK/i, '');
  const params = new URLSearchParams({ search: term, country: 'dk' });
  const data = await getJson<DkCompany>(`https://cvrapi.dk/api?${params}`, { 'user-agent': 'Billanta invoicing - contact lookup' });
  if (!data || data.error || !data.vat || !data.name || data.enddate) return [];
  return [
    {
      registry: 'DK',
      regNumber: String(data.vat),
      vatId: `DK${data.vat}`,
      name: calm(data.name) ?? data.name,
      street: data.address ?? null,
      city: data.city ?? null,
      postalCode: data.zipcode ?? null,
      country: 'DK',
      isVatPayer: null,
    },
  ];
}

// ---------------------------------------------------------------- CH

const UID_URL = 'https://www.uid-wse.admin.ch/V5.0/PublicServices.svc';
const ECH97 = 'http://www.ech.ch/xmlns/eCH-0097/5';
const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const xmlUnescape = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+);/g, (_m, e: string) => XML_ENTITIES[e] ?? String.fromCharCode(Number(e.slice(1))));
/** Text content of the first <name> element (any namespace prefix) in a fragment. */
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? xmlUnescape(m[1]!.trim()) : null;
};
const formatChe = (d: string) => `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}`;

async function uidCall(action: string, body: string): Promise<string> {
  const res = await fetch(UID_URL, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: `"http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/${action}"` },
    body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${body}</s:Body></s:Envelope>`,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  // Business faults (nothing found, bad input) come back as HTTP 500 with a <s:Fault>.
  if (!res.ok && !text.includes('Fault')) throw new Error(`uid-wse.admin.ch responded ${res.status}`);
  return text;
}

/** Swiss UID register (public, key-less SOAP). A CHE number looks up one entity, anything else searches names. */
export async function searchSwitzerland(q: string, limit = 6): Promise<RegistryHit[]> {
  const term = q.trim();
  const uidMatch = /^(?:CHE)?[-\s]?(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})(?:\s*(?:MWST|TVA|IVA))?$/i.exec(term);
  const xml = uidMatch
    ? await uidCall(
        'GetByUID',
        `<GetByUID xmlns="http://www.uid.admin.ch/xmlns/uid-wse"><uid><uidOrganisationIdCategorie xmlns="${ECH97}">CHE</uidOrganisationIdCategorie><uidOrganisationId xmlns="${ECH97}">${uidMatch.slice(1).join('')}</uidOrganisationId></uid></GetByUID>`,
      )
    : await uidCall(
        'Search',
        `<Search xmlns="http://www.uid.admin.ch/xmlns/uid-wse"><searchParameters><uidEntitySearchParameters xmlns="http://www.uid.admin.ch/xmlns/uid-wse/5"><organisationName>${xmlEscape(term.slice(0, 100))}</organisationName></uidEntitySearchParameters></searchParameters><config><searchMode xmlns="http://www.uid.admin.ch/xmlns/uid-wse-shared/2">Auto</searchMode><maxNumberOfRecords xmlns="http://www.uid.admin.ch/xmlns/uid-wse-shared/2">${limit}</maxNumberOfRecords></config></Search>`,
      );
  // Each result is one eCH-0108 organisation: identification, addresses, then VAT info.
  const blocks = xml.split(/<(?:\w+:)?organisationIdentification[\s>]/).slice(1);
  const hits: RegistryHit[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const uid = tag(block, 'uidOrganisationId');
    const name = tag(block, 'organisationName') ?? tag(block, 'organisationLegalName');
    if (!uid || !name || seen.has(uid)) continue;
    seen.add(uid);
    const addresses = block.match(/<(?:\w+:)?address[\s>][\s\S]*?<\/(?:\w+:)?address>/g) ?? [];
    const legal = addresses.find((a) => a.includes('>LEGAL<')) ?? addresses[0] ?? '';
    const vatStatus = tag(block, 'vatStatus');
    const vatSection = /<(?:\w+:)?uidVat>[\s\S]*?<\/(?:\w+:)?uidVat>/.exec(block)?.[0];
    const vatDigits = (vatSection && tag(vatSection, 'uidOrganisationId')) || uid;
    const active = vatStatus === '2';
    const street = tag(legal, 'street');
    hits.push({
      registry: 'CH',
      regNumber: formatChe(uid),
      vatId: active ? `${formatChe(vatDigits)} MWST` : null,
      name,
      street: street ? [street, tag(legal, 'houseNumber')].filter(Boolean).join(' ') : null,
      city: tag(legal, 'town'),
      postalCode: tag(legal, 'swissZipCode'),
      country: 'CH',
      isVatPayer: vatStatus ? active : null,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
