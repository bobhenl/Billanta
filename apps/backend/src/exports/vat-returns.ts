/**
 * Czech VAT filings as EPO XML (the files the tax portal "Daňová informační
 * schránka / EPO" imports): the VAT return (DPHDP3), the VAT control
 * statement (DPHKH1) and the EC sales list (DPHSHV).
 *
 * Ported and extended from faktorio (MIT, © Jiri Spac) —
 * `generateDanovePriznaniXML.ts`, `generateKontrolniHlaseniXML.ts`,
 * `generateSouhrnneHlaseniXML.ts`. Differences: both VAT rates (21 % and
 * the reduced 12 %) instead of 21 % only, explicit reverse-charge flags
 * instead of guessing from a zero VAT amount, export to non-EU customers,
 * excess deduction (`dano_no`) and XML escaping of the submitter's data.
 *
 * Pure functions: callers pass documents already converted to CZK.
 * The output is a starting point the person reviews in EPO before filing —
 * e.g. the tax office (`c_ufo`) is picked there, and EU supplies are all
 * reported as services (code 3), since documents don't say goods/services.
 */

export interface VatSubmitter {
  /** Full DIČ incl. the CZ prefix. */
  dic: string;
  /** F = natural person (OSVČ), P = legal person. */
  typDs: "F" | "P";
  jmeno: string;
  prijmeni: string;
  nazevPravOsoby: string;
  obec: string;
  ulice: string;
  cPop: string;
  cOrient: string;
  psc: string;
  stat: string;
  email: string;
  telefon: string;
}

/** One VAT rate group of a document, in CZK. */
export interface VatRatePart {
  ratePercent: number;
  base: number;
  vat: number;
}

export interface VatIssuedDoc {
  number: string;
  /** Customer DIČ as printed (CZ12345678, SK2020..., DE...), or null. */
  customerDic: string | null;
  /** Customer's country (ISO 3166-1 alpha-2). */
  customerCountry: string;
  taxableDate: Date;
  reverseCharge: boolean;
  parts: VatRatePart[];
  /** Document total incl. VAT, CZK. */
  totalCzk: number;
}

export interface VatReceivedDoc {
  number: string;
  supplierDic: string | null;
  taxableDate: Date;
  parts: VatRatePart[];
  totalCzk: number;
}

export type VatPeriod = { year: number; month: number } | { year: number; quarter: number };

const EU = new Set([
  "AT", "BE", "BG", "CY", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);
/** KH itemizes documents above CZK 10,000 incl. VAT (A.4 / B.2). */
const KH_THRESHOLD = 10_000;

const xmlAttr = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const int = (n: number) => String(Math.round(n));
const czDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
/** DIČ without the country prefix, as EPO wants it. */
const dicNumber = (dic: string) => dic.replace(/^[A-Z]{2}/i, "");
const dicCountry = (dic: string | null) => (dic && /^[A-Z]{2}/i.test(dic) ? dic.slice(0, 2).toUpperCase() : null);

/** 21 % → band 1 (základní), anything else above 0 → band 2 (snížená). */
function bands(parts: VatRatePart[]) {
  const out = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  for (const p of parts) {
    if (p.ratePercent <= 0) continue;
    if (p.ratePercent >= 19) {
      out.base1 += p.base;
      out.vat1 += p.vat;
    } else {
      out.base2 += p.base;
      out.vat2 += p.vat;
    }
  }
  return out;
}

const baseOf = (parts: VatRatePart[]) => parts.reduce((s, p) => s + p.base, 0);

type IssuedKind = "domestic" | "domestic_reverse" | "eu" | "export";

/** Where an issued document belongs in the return. */
export function classifyIssued(doc: VatIssuedDoc): IssuedKind {
  const country = dicCountry(doc.customerDic) ?? doc.customerCountry.toUpperCase();
  if (country === "CZ") return doc.reverseCharge ? "domestic_reverse" : "domestic";
  if (EU.has(country)) {
    // An EU customer without a VAT ID is taxed like a domestic one.
    return doc.customerDic ? "eu" : "domestic";
  }
  return "export";
}

function periodAttr(period: VatPeriod) {
  return "quarter" in period ? `ctvrt="${period.quarter}"` : `mesic="${period.month}"`;
}

function vetaP(s: VatSubmitter, extra = "") {
  const attrs: [string, string][] = [
    ["dic", dicNumber(s.dic)],
    ["typ_ds", s.typDs],
    ...(s.typDs === "P"
      ? ([["nazev_prav_osoby", s.nazevPravOsoby]] as [string, string][])
      : ([
          ["jmeno", s.jmeno],
          ["prijmeni", s.prijmeni],
        ] as [string, string][])),
    ["naz_obce", s.obec],
    ["ulice", s.ulice],
    ["c_pop", s.cPop],
    ["c_orient", s.cOrient],
    ["psc", s.psc.replace(/\s/g, "")],
    ["stat", s.stat],
    ["email", s.email],
    ["c_telef", s.telefon],
  ];
  const body = attrs
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}="${xmlAttr(v)}"`)
    .join(" ");
  return `<VetaP ${body}${extra} />`;
}

const header = (verzeSW: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="EPO MF ČR" verzeSW="${verzeSW}">`;

/** Přiznání k DPH (DPHDP3). */
export function generateDphDp3(input: {
  issued: VatIssuedDoc[];
  received: VatReceivedDoc[];
  submitter: VatSubmitter;
  period: VatPeriod;
  today?: Date;
}): string {
  let obrat23 = 0;
  let dan23 = 0;
  let obrat5 = 0;
  let dan5 = 0;
  let plnSluzby = 0;
  let plnRezPren = 0;
  let plnOst = 0;
  for (const doc of input.issued) {
    const kind = classifyIssued(doc);
    if (kind === "domestic") {
      const b = bands(doc.parts);
      obrat23 += b.base1;
      dan23 += b.vat1;
      obrat5 += b.base2;
      dan5 += b.vat2;
    } else if (kind === "domestic_reverse") plnRezPren += baseOf(doc.parts);
    else if (kind === "eu") plnSluzby += baseOf(doc.parts);
    else plnOst += baseOf(doc.parts);
  }

  let pln23 = 0;
  let odp23 = 0;
  let pln5 = 0;
  let odp5 = 0;
  for (const doc of input.received) {
    const b = bands(doc.parts);
    pln23 += b.base1;
    odp23 += b.vat1;
    pln5 += b.base2;
    odp5 += b.vat2;
  }

  // Totals from the rounded line values, as EPO re-checks them.
  const danZocelk = Math.round(dan23) + Math.round(dan5);
  const odpZocelk = Math.round(odp23) + Math.round(odp5);
  const diff = danZocelk - odpZocelk;

  const attrs = (pairs: [string, number][]) =>
    pairs
      .filter(([, v]) => Math.round(v) !== 0)
      .map(([k, v]) => `${k}="${int(v)}"`)
      .join(" ");
  const veta = (name: string, pairs: [string, number][]) => {
    const a = attrs(pairs);
    return a ? `\n  <${name} ${a} />` : "";
  };

  return `${header("41.6.1")}
<DPHDP3 verzePis="01.02">
  <VetaD k_uladis="DPH" dokument="DP3" rok="${input.period.year}" ${periodAttr(input.period)} d_poddp="${czDate(input.today ?? new Date())}" dapdph_forma="B" typ_platce="P" trans="A" />
  ${vetaP(input.submitter)}${veta("Veta1", [
    ["obrat23", obrat23],
    ["dan23", dan23],
    ["obrat5", obrat5],
    ["dan5", dan5],
  ])}${veta("Veta2", [
    ["pln_sluzby", plnSluzby],
    ["pln_rez_pren", plnRezPren],
    ["pln_ost", plnOst],
  ])}${veta("Veta4", [
    ["pln23", pln23],
    ["odp_tuz23_nar", odp23],
    ["pln5", pln5],
    ["odp_tuz5_nar", odp5],
    ["odp_sum_nar", Math.round(odp23) + Math.round(odp5)],
  ])}
  <Veta6 dan_zocelk="${danZocelk}" odp_zocelk="${odpZocelk}" dano_da="${Math.max(0, diff)}" dano_no="${Math.max(0, -diff)}" />
</DPHDP3>
</Pisemnost>
`;
}

/** Kontrolní hlášení (DPHKH1). */
export function generateDphKh1(input: {
  issued: VatIssuedDoc[];
  received: VatReceivedDoc[];
  submitter: VatSubmitter;
  period: VatPeriod;
  today?: Date;
}): string {
  const a1: string[] = [];
  const a4: string[] = [];
  const a5 = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  const c = { obrat23: 0, obrat5: 0, plnRezPren: 0, pln23: 0, pln5: 0 };

  for (const doc of input.issued) {
    const kind = classifyIssued(doc);
    if (kind === "domestic_reverse" && doc.customerDic) {
      const base = baseOf(doc.parts);
      c.plnRezPren += base;
      a1.push(
        `<VetaA1 c_radku="${a1.length + 1}" dic_odb="${xmlAttr(dicNumber(doc.customerDic))}" c_evid_dd="${xmlAttr(doc.number)}" duzp="${czDate(doc.taxableDate)}" zakl_dane1="${int(base)}" />`,
      );
      continue;
    }
    if (kind !== "domestic") continue; // EU and export supplies are not in KH.
    const b = bands(doc.parts);
    c.obrat23 += b.base1;
    c.obrat5 += b.base2;
    const czDic = dicCountry(doc.customerDic) === "CZ" ? doc.customerDic! : null;
    if (czDic && Math.abs(Math.round(doc.totalCzk)) > KH_THRESHOLD) {
      a4.push(
        `<VetaA4 c_radku="${a4.length + 1}" dic_odb="${xmlAttr(dicNumber(czDic))}" c_evid_dd="${xmlAttr(doc.number)}" dppd="${czDate(doc.taxableDate)}" zakl_dane1="${int(b.base1)}" dan1="${int(b.vat1)}" zakl_dane2="${int(b.base2)}" dan2="${int(b.vat2)}" kod_rezim_pl="0" zdph_44="N" />`,
      );
    } else {
      a5.base1 += b.base1;
      a5.vat1 += b.vat1;
      a5.base2 += b.base2;
      a5.vat2 += b.vat2;
    }
  }

  const b2: string[] = [];
  const b3 = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  for (const doc of input.received) {
    const b = bands(doc.parts);
    if (b.vat1 === 0 && b.vat2 === 0) continue; // Nothing to deduct.
    c.pln23 += b.base1;
    c.pln5 += b.base2;
    const czDic = dicCountry(doc.supplierDic) === "CZ" ? doc.supplierDic! : null;
    if (czDic && doc.number && Math.abs(Math.round(doc.totalCzk)) > KH_THRESHOLD) {
      b2.push(
        `<VetaB2 c_radku="${b2.length + 1}" dic_dod="${xmlAttr(dicNumber(czDic))}" c_evid_dd="${xmlAttr(doc.number)}" dppd="${czDate(doc.taxableDate)}" zakl_dane1="${int(b.base1)}" dan1="${int(b.vat1)}" zakl_dane2="${int(b.base2)}" dan2="${int(b.vat2)}" pomer="N" zdph_44="N" />`,
      );
    } else {
      b3.base1 += b.base1;
      b3.vat1 += b.vat1;
      b3.base2 += b.base2;
      b3.vat2 += b.vat2;
    }
  }

  const sum = (s: typeof a5) =>
    `zakl_dane1="${int(s.base1)}" dan1="${int(s.vat1)}" zakl_dane2="${int(s.base2)}" dan2="${int(s.vat2)}"`;
  const rows = [
    ...a1,
    ...a4,
    ...(a5.base1 || a5.base2 ? [`<VetaA5 ${sum(a5)} />`] : []),
    ...b2,
    ...(b3.base1 || b3.base2 ? [`<VetaB3 ${sum(b3)} />`] : []),
    `<VetaC obrat23="${int(c.obrat23)}" obrat5="${int(c.obrat5)}" pln23="${int(c.pln23)}" pln5="${int(c.pln5)}" pln_rez_pren="${int(c.plnRezPren)}" />`,
  ];

  return `${header("41.16.3")}
<DPHKH1 verzePis="03.01">
  <VetaD k_uladis="DPH" dokument="KH1" rok="${input.period.year}" ${periodAttr(input.period)} d_poddp="${czDate(input.today ?? new Date())}" khdph_forma="B" />
  ${vetaP(input.submitter)}
  ${rows.join("\n  ")}
</DPHKH1>
</Pisemnost>
`;
}

/**
 * Souhrnné hlášení (DPHSHV): supplies to VAT-registered customers in other
 * EU states, one row per customer VAT ID. Returns null when there is
 * nothing to report (no filing is due then).
 */
export function generateDphShv(input: {
  issued: VatIssuedDoc[];
  submitter: VatSubmitter;
  period: VatPeriod;
  today?: Date;
}): string | null {
  const rows = new Map<string, { country: string; vat: string; count: number; value: number }>();
  for (const doc of input.issued) {
    if (classifyIssued(doc) !== "eu" || !doc.customerDic) continue;
    const country = dicCountry(doc.customerDic)!;
    const vat = dicNumber(doc.customerDic);
    const key = `${country}${vat}`;
    const row = rows.get(key) ?? { country: country === "GR" ? "EL" : country, vat, count: 0, value: 0 };
    row.count += 1;
    row.value += baseOf(doc.parts);
    rows.set(key, row);
  }
  if (rows.size === 0) return null;
  const vetaR = [...rows.values()].map(
    (r, i) =>
      `<VetaR por_c_stran="1" c_rad="${i + 1}" k_stat="${r.country}" c_vat="${xmlAttr(r.vat)}" k_pln_eu="3" pln_pocet="${r.count}" pln_hodnota="${int(r.value)}" />`,
  );
  return `${header("45.5.1")}
<DPHSHV verzePis="02.01">
  <VetaD k_uladis="DPH" dokument="SHV" rok="${input.period.year}" ${periodAttr(input.period)} shvies_forma="R" d_poddp="${czDate(input.today ?? new Date())}" />
  ${vetaP(input.submitter)}
  ${vetaR.join("\n  ")}
</DPHSHV>
</Pisemnost>
`;
}

const LEGAL_FORM = /\b(s\.\s?r\.\s?o\.|spol\.|a\.\s?s\.|v\.\s?o\.\s?s\.|k\.\s?s\.|z\.\s?s\.|z\.\s?ú\.|o\.\s?p\.\s?s\.|družstvo|SE)\s*$/i;

/** Builds the submitter block from the company's settings. */
export function submitterFromTenant(t: {
  legalName: string;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  email: string | null;
  phone: string | null;
}): VatSubmitter {
  const legal = LEGAL_FORM.test(t.legalName.trim());
  const name = t.legalName.trim().split(/\s+/);
  // "Masarykova 12/3a" → street, číslo popisné, číslo orientační.
  const street = (t.addressStreet ?? "").trim();
  const m = street.match(/^(.*?)[\s,]+(\d+)(?:\/(\w+))?$/);
  return {
    dic: t.dic ?? "",
    typDs: legal ? "P" : "F",
    jmeno: legal ? "" : (name[0] ?? ""),
    prijmeni: legal ? "" : name.slice(1).join(" "),
    nazevPravOsoby: legal ? t.legalName.trim() : "",
    obec: t.addressCity ?? "",
    ulice: m ? m[1]! : street,
    cPop: m ? m[2]! : "",
    cOrient: m?.[3] ?? "",
    psc: t.addressPostalCode ?? "",
    stat: t.addressCountry === "CZ" ? "ČESKÁ REPUBLIKA" : t.addressCountry,
    email: t.email ?? "",
    telefon: t.phone ?? "",
  };
}
