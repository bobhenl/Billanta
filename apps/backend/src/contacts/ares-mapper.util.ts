import type { AresSubject, RegistryHit, RpoSubject, RuzSubject } from "@faktur/cz-compliance";

/**
 * Pure mapping from an ARES `AresSubject` (or a same-shaped row read back out
 * of the `ares_cache.response_payload` jsonb column) to the flat shape this
 * backend's `contacts` table / dashboard "create contact from ARES" flow
 * actually wants to pre-fill: `contacts.legalName/ico/dic/isVatPayer/
 * addressStreet/addressCity/addressPostalCode/addressCountry` (see
 * `drizzle/schema.ts`).
 *
 * Kept as a standalone pure function (no DB, no HTTP) so the field-mapping
 * logic is unit-testable without mocking ARES or Postgres.
 */
export interface AresContactPrefill {
  ico: string;
  dic: string | null;
  legalName: string;
  /** Tri-state, mirroring `contacts.isVatPayer` — null means "unknown", never a fabricated false (blueprint §1/§6 step 7 ARES/ADISREG gap). */
  isVatPayer: boolean | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  /** Which register the data came from (default ARES/RPO by country). */
  source?: "ARES" | "RPO" | RegistryHit["registry"];
  /** Foreign registration number (SIREN, org.nr, NIP …) — `ico` stays empty for those. */
  regNumber?: string | null;
}

/** A hit from a foreign register (FR/NO/PL/VIES) in the same prefill shape; IČO stays empty. */
export function mapRegistryHitToContactPrefill(hit: RegistryHit): AresContactPrefill {
  return {
    ico: "",
    dic: hit.vatId,
    legalName: hit.name,
    isVatPayer: hit.isVatPayer,
    addressStreet: hit.street,
    addressCity: hit.city,
    addressPostalCode: hit.postalCode,
    addressCountry: hit.country,
    source: hit.registry,
    regNumber: hit.regNumber,
  };
}

/**
 * Builds a single-line street value out of ARES's structured address
 * fields (street name + house number + orientation number), falling back to
 * ARES's own pre-formatted `textovaAdresa` if the structured pieces are
 * missing, and finally to `null` if neither is available.
 */
function buildStreet(subject: AresSubject): string | null {
  const address = subject.sidlo;
  if (!address) {
    return null;
  }

  let houseNumber = address.cisloDomovni != null ? String(address.cisloDomovni) : "";
  if (address.cisloOrientacni != null) {
    houseNumber += `/${address.cisloOrientacni}${address.cisloOrientacniPismeno ?? ""}`;
  }
  if (address.nazevUlice) {
    return houseNumber ? `${address.nazevUlice} ${houseNumber}` : address.nazevUlice;
  }
  // A village without street names: the address is "Lhota 12". textovaAdresa would put PSČ and town into the street field too.
  const place = address.nazevCastiObce || address.nazevObce;
  if (place && houseNumber) return `${place} ${houseNumber}`;

  return address.textovaAdresa ?? null;
}

export function mapAresSubjectToContactPrefill(subject: AresSubject): AresContactPrefill {
  const address = subject.sidlo;

  return {
    ico: subject.ico,
    dic: subject.dic ?? null,
    legalName: subject.obchodniJmeno,
    // `platceDph` is the only signal ARES's base response documents for
    // this (see the long caveat on `AresSubject.platceDph`) — `dic` being
    // present does NOT by itself imply VAT-payer status, so it is
    // deliberately not used as a fallback here.
    isVatPayer: subject.platceDph ?? null,
    addressStreet: buildStreet(subject),
    addressCity: address?.nazevObce ?? null,
    addressPostalCode: address?.psc != null ? String(address.psc).padStart(5, "0") : null,
    addressCountry: address?.kodStatu ?? "CZ",
  };
}

/** Same prefill shape from the Slovak RPO register (no DIČ / VAT status there). */
export function mapRpoSubjectToContactPrefill(subject: RpoSubject): AresContactPrefill {
  return {
    ico: subject.ico,
    dic: null,
    legalName: subject.name,
    isVatPayer: null,
    addressStreet: subject.street,
    addressCity: subject.city,
    addressPostalCode: subject.postalCode,
    addressCountry: "SK",
  };
}

/** A Slovak company from RÚZ, the one SK source with the DIČ. RÚZ gets its units from ŠÚ SR (RPO), so the source stays "RPO". */
export function mapRuzSubjectToContactPrefill(subject: RuzSubject): AresContactPrefill {
  return {
    ico: subject.ico,
    dic: subject.dic,
    legalName: subject.name,
    isVatPayer: null,
    addressStreet: subject.street,
    addressCity: subject.city,
    addressPostalCode: subject.postalCode,
    addressCountry: "SK",
  };
}

/** RPO data plus the DIČ from RÚZ, when RÚZ has one for the same IČO. Name and address stay RPO's, which is fresher. */
export function withRuzDic(prefill: AresContactPrefill, ruz: RuzSubject | null): AresContactPrefill {
  return ruz?.dic && ruz.ico === prefill.ico && !prefill.dic ? { ...prefill, dic: ruz.dic } : prefill;
}
