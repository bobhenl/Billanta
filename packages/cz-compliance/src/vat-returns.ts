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
// Shared with the in-app export box and the public guide ("form version" line).
import { VAT_FORM_VERSIONS } from "./vat-filing.js";
import { withXmlDisclaimer } from "./export-disclaimer.js";

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
  /** Kód předmětu plnění (REVERSE_CHARGE_CODES) for domestic reverse charge; null = not chosen. */
  reverseChargeCode: string | null;
  parts: VatRatePart[];
  /** Document total incl. VAT, CZK. */
  totalCzk: number;
}

/**
 * Something the generated file is missing that EPO will reject or the
 * person has to add by hand. The export still returns the XML (so the rest
 * can be reviewed in EPO) and lists these next to it.
 */
export interface VatExportWarning {
  code:
    | "reverse_charge_code_missing"
    | "reverse_charge_dic_missing"
    | "received_reverse_charge_code_missing"
    | "received_reverse_charge_dic_missing"
    | "received_reverse_charge_number_missing"
    | "foreign_purchase_unmarked";
  /** Document number (a received one without a number: its date). */
  document: string;
}

export interface VatReceivedDoc {
  number: string;
  supplierDic: string | null;
  taxableDate: Date;
  /** Received in domestic reverse charge (§ 92a ZDPH): `parts` hold the self-assessed VAT. */
  reverseCharge: boolean;
  /** Kód předmětu plnění for KH B.1; null = not chosen. */
  reverseChargeCode: string | null;
  parts: VatRatePart[];
  totalCzk: number;
  /** Supplier's country (ISO 3166-1 alpha-2) from its contact; the DIČ prefix wins when there is one. */
  supplierCountry?: string | null;
}

export type VatPeriod = { year: number; month: number } | { year: number; quarter: number };

const EU = new Set([
  "AT", "BE", "BG", "CY", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);
/** KH itemizes documents above CZK 10,000 incl. VAT (A.4 / B.2). */
const KH_THRESHOLD = 10_000;

export const xmlAttr = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
// Sums are taken to haléře first (§ 146 odst. 3 DŘ counts to two decimals),
// so float noise such as 30.000000004 does not add a crown when rounding up.
const haler = (n: number) => Math.round(n * 100) / 100;
// `+ 0` turns -0 into 0, so a credit note that cancels out prints "0".
/** Mathematical rounding to whole Kč, halves away from zero (bases, deductions). */
export const roundKc = (n: number) => Math.sign(n) * Math.round(Math.abs(haler(n))) + 0;
/**
 * Tax to whole Kč upward: "Daň se zaokrouhluje na celé koruny nahoru"
 * (§ 146 odst. 1 zák. 280/2009 Sb.). Up means toward +∞, so a negative
 * line from credit notes never states less tax than owed.
 */
export const taxKc = (n: number) => Math.ceil(haler(n)) + 0;
const int = (n: number) => String(roundKc(n));
const upKc = (n: number) => String(taxKc(n));
/** KH may carry haléře (pokyny 25 5564/1, "včetně haléřové položky"), so it keeps document values. */
const kc2 = (n: number) => String(haler(n) + 0);
export const czDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
/** DIČ without the country prefix, as EPO wants it. */
export const dicNumber = (dic: string) => dic.replace(/^[A-Z]{2}/i, "");
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

export const header = (verzeSW: string) =>
  withXmlDisclaimer(`<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="EPO MF ČR" verzeSW="${verzeSW}">`);

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
  // Received in domestic reverse charge (§ 92a ZDPH): the company owes the
  // VAT as output tax (ř. 10/11, Veta1 rez_pren / dan_rpren) and deducts it
  // in full (ř. 43/44, Veta4 nar_zdp / od_zdp). Field names from the DPHDP3
  // structure description on adisspr.mfcr.cz (read 2026-10-18).
  let rezPren23 = 0;
  let danRpren23 = 0;
  let rezPren5 = 0;
  let danRpren5 = 0;
  for (const doc of input.received) {
    const b = bands(doc.parts);
    if (doc.reverseCharge) {
      rezPren23 += b.base1;
      danRpren23 += b.vat1;
      rezPren5 += b.base2;
      danRpren5 += b.vat2;
      continue;
    }
    pln23 += b.base1;
    odp23 += b.vat1;
    pln5 += b.base2;
    odp5 += b.vat2;
  }

  // The form wants whole koruny without a direction. Tax lines (ř. 1, 2,
  // 10, 11) round up by § 146 odst. 1 DŘ. Bases and deductions (ř. 40–46)
  // round mathematically: § 146 speaks of the tax, and neither ZDPH nor the
  // pokyny 25 5412 say how to round odpočet. So ř. 10 and ř. 43 can differ
  // by a crown for the same reverse-charge invoice.
  // Totals sum the rounded lines, as EPO re-checks them: ř. 62 sums ř. 1–13,
  // ř. 46 (and with it ř. 63) sums ř. 40–45, ř. 64/65 is their difference.
  const danZocelk = taxKc(dan23) + taxKc(dan5) + taxKc(danRpren23) + taxKc(danRpren5);
  const odpSumNar = roundKc(odp23) + roundKc(odp5) + roundKc(danRpren23) + roundKc(danRpren5);
  const odpZocelk = odpSumNar;
  const diff = danZocelk - odpZocelk;

  const TAX_LINES = new Set(["dan23", "dan5", "dan_rpren23", "dan_rpren5"]);
  const attrs = (pairs: [string, number][]) =>
    pairs
      .map(([k, v]) => [k, TAX_LINES.has(k) ? upKc(v) : int(v)] as const)
      .filter(([, v]) => v !== "0")
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
  const veta = (name: string, pairs: [string, number][]) => {
    const a = attrs(pairs);
    return a ? `\n  <${name} ${a} />` : "";
  };

  return `${header("41.6.1")}
<DPHDP3 verzePis="${VAT_FORM_VERSIONS.DPHDP3}">
  <VetaD k_uladis="DPH" dokument="DP3" rok="${input.period.year}" ${periodAttr(input.period)} d_poddp="${czDate(input.today ?? new Date())}" dapdph_forma="B" typ_platce="P" trans="A" />
  ${vetaP(input.submitter)}${veta("Veta1", [
    ["obrat23", obrat23],
    ["dan23", dan23],
    ["obrat5", obrat5],
    ["dan5", dan5],
    ["rez_pren23", rezPren23],
    ["dan_rpren23", danRpren23],
    ["rez_pren5", rezPren5],
    ["dan_rpren5", danRpren5],
  ])}${veta("Veta2", [
    ["pln_sluzby", plnSluzby],
    ["pln_rez_pren", plnRezPren],
    ["pln_ost", plnOst],
  ])}${veta("Veta4", [
    ["pln23", pln23],
    ["odp_tuz23_nar", odp23],
    ["pln5", pln5],
    ["odp_tuz5_nar", odp5],
    ["nar_zdp23", rezPren23],
    ["od_zdp23", danRpren23],
    ["nar_zdp5", rezPren5],
    ["od_zdp5", danRpren5],
    ["odp_sum_nar", odpSumNar],
  ])}
  <Veta6 dan_zocelk="${danZocelk}" odp_zocelk="${odpZocelk}" dano_da="${Math.max(0, diff)}" dano_no="${Math.max(0, -diff)}" />
</DPHDP3>
</Pisemnost>
`;
}

/** Where a received document's supplier sits, seen from a Czech company. */
export function supplierOrigin(doc: Pick<VatReceivedDoc, "supplierDic" | "supplierCountry">): "domestic" | "eu" | "third_country" {
  const country = dicCountry(doc.supplierDic) ?? (doc.supplierCountry || "CZ").toUpperCase();
  if (country === "CZ") return "domestic";
  return EU.has(country) ? "eu" : "third_country";
}

/**
 * Přiznání k DPH (DPHDP3) of an identified person (§ 6g–6l ZDPH, typ_platce
 * "I"). It is filed only for a month in which the person owes VAT, which for
 * an OSVČ means a service bought from a supplier abroad (§ 9 odst. 1, § 108
 * odst. 1 písm. c): an EU supplier goes to ř. 5/6 (Veta1 p_sl23_e /
 * dan_psl23_e, p_sl5_e / dan_psl5_e), a supplier outside the EU to ř. 12/13
 * (p_sl23_z / dan_psl23_z, p_sl5_z / dan_psl5_z). Services supplied to EU
 * businesses go to ř. 21 (pln_sluzby). An identified person has no right to
 * deduct (§ 72 needs a payer), so there is no Veta4 and the whole tax is
 * due. It files no kontrolní hlášení either (§ 101c applies to payers).
 *
 * `received` should include expenses without a VAT rate: a foreign purchase
 * that is not marked as reverse charge with a rate is listed as a warning,
 * since its tax can't be computed and an ad invoice entered as a plain
 * expense is the usual slip. Returns null xml when nothing is due.
 */
export function generateDphDp3Identified(input: {
  issued: VatIssuedDoc[];
  received: VatReceivedDoc[];
  submitter: VatSubmitter;
  period: { year: number; month: number };
  today?: Date;
}): { xml: string | null; warnings: VatExportWarning[] } {
  const eu = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  const third = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  const warnings: VatExportWarning[] = [];
  for (const doc of input.received) {
    const origin = supplierOrigin(doc);
    // A Czech supplier's invoice carries no tax for a non-payer to report.
    if (origin === "domestic") continue;
    const b = bands(doc.parts);
    if (!doc.reverseCharge || (b.base1 === 0 && b.base2 === 0)) {
      warnings.push({ code: "foreign_purchase_unmarked", document: doc.number || czDate(doc.taxableDate) });
      continue;
    }
    const into = origin === "eu" ? eu : third;
    into.base1 += b.base1;
    into.vat1 += b.vat1;
    into.base2 += b.base2;
    into.vat2 += b.vat2;
  }
  let plnSluzby = 0;
  for (const doc of input.issued) if (classifyIssued(doc) === "eu") plnSluzby += baseOf(doc.parts);

  // Tax lines (dan_*) round up by § 146 odst. 1 DŘ, bases mathematically.
  const nonZero = (pairs: [string, number][]) =>
    pairs.map(([k, v]) => [k, k.startsWith("dan_") ? upKc(v) : int(v)] as const).filter(([, v]) => v !== "0");
  const veta1 = nonZero([
    ["p_sl23_e", eu.base1],
    ["dan_psl23_e", eu.vat1],
    ["p_sl5_e", eu.base2],
    ["dan_psl5_e", eu.vat2],
    ["p_sl23_z", third.base1],
    ["dan_psl23_z", third.vat1],
    ["p_sl5_z", third.base2],
    ["dan_psl5_z", third.vat2],
  ]);
  const veta2 = nonZero([["pln_sluzby", plnSluzby]]);
  if (veta1.length === 0 && veta2.length === 0) return { xml: null, warnings };
  // ř. 62 sums the rounded tax lines; ř. 63 (odpočet) is always 0 here.
  const danZocelk = [eu.vat1, eu.vat2, third.vat1, third.vat2].reduce((s, v) => s + taxKc(v), 0);
  const line = (name: string, pairs: (readonly [string, string])[]) =>
    pairs.length ? `\n  <${name} ${pairs.map(([k, v]) => `${k}="${v}"`).join(" ")} />` : "";

  const xml = `${header("41.6.1")}
<DPHDP3 verzePis="${VAT_FORM_VERSIONS.DPHDP3}">
  <VetaD k_uladis="DPH" dokument="DP3" rok="${input.period.year}" ${periodAttr(input.period)} d_poddp="${czDate(input.today ?? new Date())}" dapdph_forma="B" typ_platce="I" trans="A" />
  ${vetaP(input.submitter)}${line("Veta1", veta1)}${line("Veta2", veta2)}
  <Veta6 dan_zocelk="${danZocelk}" odp_zocelk="0" dano_da="${danZocelk}" dano_no="0" />
</DPHDP3>
</Pisemnost>
`;
  return { xml, warnings };
}

/**
 * Kontrolní hlášení (DPHKH1).
 *
 * Received documents in domestic reverse charge go to B.1, one row each with
 * no threshold; the rest to B.2/B.3. VetaC rez_pren23/rez_pren5 repeat the
 * B.1 bases (DPHDP3 ř. 10/11). Source: the DPHKH1 structure description on
 * adisspr.mfcr.cz (read 2026-10-18).
 *
 * Amounts keep their haléře, as on the documents: the pokyny (25 5564/1)
 * allow "v detailu (včetně haléřové položky)". Rounding each row to whole
 * koruny would make part C drift from the rows it sums.
 */
export function generateDphKh1(input: {
  issued: VatIssuedDoc[];
  received: VatReceivedDoc[];
  submitter: VatSubmitter;
  period: VatPeriod;
  today?: Date;
}): { xml: string; warnings: VatExportWarning[] } {
  const a1: string[] = [];
  const a4: string[] = [];
  const a5 = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  const c = { obrat23: 0, obrat5: 0, plnRezPren: 0, pln23: 0, pln5: 0, rezPren23: 0, rezPren5: 0 };
  const warnings: VatExportWarning[] = [];

  for (const doc of input.issued) {
    const kind = classifyIssued(doc);
    if (kind === "domestic_reverse") {
      // A.1 is keyed on the customer's DIČ; without it there is no row to write.
      if (!doc.customerDic) {
        warnings.push({ code: "reverse_charge_dic_missing", document: doc.number });
        continue;
      }
      const base = baseOf(doc.parts);
      c.plnRezPren += base;
      // EPO rejects an A.1 row without kod_pred_pl. Guessing one (say 4,
      // construction) would file a wrong statement, so leave it out and
      // tell the person which documents need it.
      if (!doc.reverseChargeCode) warnings.push({ code: "reverse_charge_code_missing", document: doc.number });
      const code = doc.reverseChargeCode ? ` kod_pred_pl="${xmlAttr(doc.reverseChargeCode)}"` : "";
      a1.push(
        `<VetaA1 c_radku="${a1.length + 1}" dic_odb="${xmlAttr(dicNumber(doc.customerDic))}" c_evid_dd="${xmlAttr(doc.number)}" duzp="${czDate(doc.taxableDate)}" zakl_dane1="${kc2(base)}"${code} />`,
      );
      continue;
    }
    if (kind !== "domestic") continue; // EU and export supplies are not in KH.
    const b = bands(doc.parts);
    c.obrat23 += b.base1;
    c.obrat5 += b.base2;
    const czDic = dicCountry(doc.customerDic) === "CZ" ? doc.customerDic! : null;
    if (czDic && Math.abs(haler(doc.totalCzk)) > KH_THRESHOLD) {
      a4.push(
        `<VetaA4 c_radku="${a4.length + 1}" dic_odb="${xmlAttr(dicNumber(czDic))}" c_evid_dd="${xmlAttr(doc.number)}" dppd="${czDate(doc.taxableDate)}" zakl_dane1="${kc2(b.base1)}" dan1="${kc2(b.vat1)}" zakl_dane2="${kc2(b.base2)}" dan2="${kc2(b.vat2)}" kod_rezim_pl="0" zdph_44="N" />`,
      );
    } else {
      a5.base1 += b.base1;
      a5.vat1 += b.vat1;
      a5.base2 += b.base2;
      a5.vat2 += b.vat2;
    }
  }

  const b1: string[] = [];
  const b2: string[] = [];
  const b3 = { base1: 0, vat1: 0, base2: 0, vat2: 0 };
  for (const doc of input.received) {
    const b = bands(doc.parts);
    if (doc.reverseCharge) {
      const label = doc.number || czDate(doc.taxableDate);
      // B.1 is keyed on the supplier's DIČ and document number, and EPO
      // refuses a row without either. Same handling as A.1 above.
      if (!doc.supplierDic) {
        warnings.push({ code: "received_reverse_charge_dic_missing", document: label });
        continue;
      }
      if (!doc.number) {
        warnings.push({ code: "received_reverse_charge_number_missing", document: label });
        continue;
      }
      c.rezPren23 += b.base1;
      c.rezPren5 += b.base2;
      if (!doc.reverseChargeCode) warnings.push({ code: "received_reverse_charge_code_missing", document: label });
      const code = doc.reverseChargeCode ? ` kod_pred_pl="${xmlAttr(doc.reverseChargeCode)}"` : "";
      b1.push(
        `<VetaB1 c_radku="${b1.length + 1}" dic_dod="${xmlAttr(dicNumber(doc.supplierDic))}" c_evid_dd="${xmlAttr(doc.number)}" duzp="${czDate(doc.taxableDate)}" zakl_dane1="${kc2(b.base1)}" dan1="${kc2(b.vat1)}" zakl_dane2="${kc2(b.base2)}" dan2="${kc2(b.vat2)}"${code} />`,
      );
      continue;
    }
    if (b.vat1 === 0 && b.vat2 === 0) continue; // Nothing to deduct.
    c.pln23 += b.base1;
    c.pln5 += b.base2;
    const czDic = dicCountry(doc.supplierDic) === "CZ" ? doc.supplierDic! : null;
    if (czDic && doc.number && Math.abs(haler(doc.totalCzk)) > KH_THRESHOLD) {
      b2.push(
        `<VetaB2 c_radku="${b2.length + 1}" dic_dod="${xmlAttr(dicNumber(czDic))}" c_evid_dd="${xmlAttr(doc.number)}" dppd="${czDate(doc.taxableDate)}" zakl_dane1="${kc2(b.base1)}" dan1="${kc2(b.vat1)}" zakl_dane2="${kc2(b.base2)}" dan2="${kc2(b.vat2)}" pomer="N" zdph_44="N" />`,
      );
    } else {
      b3.base1 += b.base1;
      b3.vat1 += b.vat1;
      b3.base2 += b.base2;
      b3.vat2 += b.vat2;
    }
  }

  const sum = (s: typeof a5) =>
    `zakl_dane1="${kc2(s.base1)}" dan1="${kc2(s.vat1)}" zakl_dane2="${kc2(s.base2)}" dan2="${kc2(s.vat2)}"`;
  const rows = [
    ...a1,
    ...a4,
    ...(a5.base1 || a5.base2 ? [`<VetaA5 ${sum(a5)} />`] : []),
    ...b1,
    ...b2,
    ...(b3.base1 || b3.base2 ? [`<VetaB3 ${sum(b3)} />`] : []),
    `<VetaC obrat23="${kc2(c.obrat23)}" obrat5="${kc2(c.obrat5)}" pln23="${kc2(c.pln23)}" pln5="${kc2(c.pln5)}" pln_rez_pren="${kc2(c.plnRezPren)}" rez_pren23="${kc2(c.rezPren23)}" rez_pren5="${kc2(c.rezPren5)}" />`,
  ];

  const xml = `${header("41.16.3")}
<DPHKH1 verzePis="${VAT_FORM_VERSIONS.DPHKH1}">
  <VetaD k_uladis="DPH" dokument="KH1" rok="${input.period.year}" ${periodAttr(input.period)} d_poddp="${czDate(input.today ?? new Date())}" khdph_forma="B" />
  ${vetaP(input.submitter)}
  ${rows.join("\n  ")}
</DPHKH1>
</Pisemnost>
`;
  return { xml, warnings };
}

/**
 * Souhrnné hlášení (DPHSHV): supplies to VAT-registered customers in other
 * EU states, one row per customer VAT ID. Returns null when there is
 * nothing to report (no filing is due then). The row value rounds up:
 * "Celková hodnota plnění se zaokrouhlí na celé koruny nahoru" (pokyny
 * 25 5525), with credit notes already subtracted inside the row.
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
      `<VetaR por_c_stran="1" c_rad="${i + 1}" k_stat="${r.country}" c_vat="${xmlAttr(r.vat)}" k_pln_eu="3" pln_pocet="${r.count}" pln_hodnota="${upKc(r.value)}" />`,
  );
  return `${header("45.5.1")}
<DPHSHV verzePis="${VAT_FORM_VERSIONS.DPHSHV}">
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
