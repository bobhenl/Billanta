/**
 * Slovak VAT filings as the XML the eDane / eSlužby portal of Finančná
 * správa SR imports: the VAT return (DPHv25, from 1. 7. 2025), the VAT
 * control statement (KVDPHv25) and the EC sales list (SVDPHv20). Element
 * order and required fields follow the published XSDs (`dph2025.xsd`,
 * `kv_dph_2025.xsd`, `svdph20.xsd`). Paragraphs cited below are zákon
 * č. 222/2004 Z. z. o dani z pridanej hodnoty.
 *
 * Pure functions: callers pass documents already converted to EUR (§ 26
 * ods. 1: ECB/NBS rate of the day before the tax point). Amounts are
 * rounded to the cent (§ 78 ods. 7), SV values to whole euros.
 *
 * The output is a draft the person reviews in eDane before filing:
 *  - the tax office (`danovyUrad`) is left empty and picked there;
 *  - supplies to EU customers with a VAT ID are all reported as services
 *    under § 15 ods. 1 (SV code 2), and supplies outside the EU as services
 *    with the place of supply abroad (in no DPH row), since documents don't
 *    say goods/services; EU goods (§ 43, r14) and exports (§ 47, r15) have
 *    to be moved by hand;
 *  - domestic reverse charge on issued invoices (§ 69 ods. 12) goes to
 *    KV A.2 only, as the return has no supplier-side row for it;
 *  - received documents without the supplier's IČ DPH are treated as
 *    simplified invoices (KV B.3.1).
 */
import type { VatPeriod, VatRatePart } from "./vat-returns";

export interface SkSubmitter {
  /** IČ DPH incl. the SK prefix (SK + 10 digits). */
  icDph: string;
  /** Name as in the commercial / trade register. */
  nazov: string;
  ulica: string;
  cislo: string;
  psc: string;
  obec: string;
  stat: string;
  telefon: string;
  email: string;
}

export interface SkIssuedDoc {
  number: string;
  /** Customer's IČ DPH / VAT ID as printed (SK2020…, CZ…, DE…), or null. */
  customerVatId: string | null;
  /** Customer's country (ISO 3166-1 alpha-2). */
  customerCountry: string;
  /** Tax point (§ 19), the supply date or else the issue date. */
  taxableDate: Date;
  reverseCharge: boolean;
  /** Rate groups in EUR; a credit note carries negative amounts. */
  parts: VatRatePart[];
  /** Set on a credit note (opravná faktúra, § 71 ods. 3): the corrected invoice's number. */
  correctsNumber?: string | null;
}

export interface SkReceivedDoc {
  number: string;
  supplierVatId: string | null;
  taxableDate: Date;
  parts: VatRatePart[];
}

const EU = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "EL", "HR", "HU", "IE",
  "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI",
]);
/** KV B.3.2 itemizes simplified invoices per supplier from this much deducted tax. */
const KV_SIMPLIFIED_THRESHOLD = 3_000;
const KV_NS = "https://ekr.financnasprava.sk/Formulare/XSD/kv_dph_2025.xsd";
const SV_ROWS_PER_PAGE = 12;

const xml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const cents = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => cents(n).toFixed(2);
/** DPH rows: empty instead of 0, like the paper form. */
const row = (n: number) => (cents(n) === 0 ? "" : eur(n));
const pad = (n: number) => String(n).padStart(2, "0");
const skDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const vatCountry = (id: string | null) => (id && /^[A-Z]{2}/i.test(id) ? id.slice(0, 2).toUpperCase() : null);
const vatNumber = (id: string) => id.replace(/^[A-Z]{2}/i, "").replace(/\s/g, "");
const compact = (id: string) => id.replace(/\s/g, "").toUpperCase();
/** Invoice numbers go into KV without spaces (poučenie, A.1). */
const docNo = (n: string) => n.replace(/\s/g, "") || "0";

type Band = "basic" | "reduced19" | "reduced5";

/** § 27: 23 % basic, 19 % (ods. 2) and 5 % (ods. 3) reduced. */
function band(rate: number): Band {
  if (rate >= 21) return "basic";
  if (rate >= 10) return "reduced19";
  return "reduced5";
}

const BAND_RATE: Record<Band, number> = { basic: 23, reduced19: 19, reduced5: 5 };

function byBand(parts: VatRatePart[]) {
  const out = new Map<Band, { base: number; vat: number }>();
  for (const p of parts) {
    if (p.ratePercent <= 0) continue;
    const b = band(p.ratePercent);
    const cur = out.get(b) ?? { base: 0, vat: 0 };
    cur.base += p.base;
    cur.vat += p.vat;
    out.set(b, cur);
  }
  return out;
}

const baseOf = (parts: VatRatePart[]) => parts.reduce((s, p) => s + p.base, 0);

export type SkIssuedKind = "domestic" | "domestic_reverse" | "eu" | "foreign";

/** Where an issued document belongs in the Slovak filings. */
export function classifySkIssued(doc: SkIssuedDoc): SkIssuedKind {
  const country = vatCountry(doc.customerVatId) ?? doc.customerCountry.toUpperCase();
  if (country === "SK") return doc.reverseCharge ? "domestic_reverse" : "domestic";
  // An EU customer without a VAT ID is taxed like a domestic one.
  if (EU.has(country)) return doc.customerVatId ? "eu" : "domestic";
  return "foreign";
}

/** Deductible tax only comes from Slovak suppliers' invoices (§ 49 ods. 2 písm. a). */
function deductible(doc: SkReceivedDoc) {
  const country = vatCountry(doc.supplierVatId);
  return country === null || country === "SK";
}

/** Daňové priznanie k DPH (DPHv25), riadne. */
export function generateSkDphV25(input: {
  issued: SkIssuedDoc[];
  received: SkReceivedDoc[];
  submitter: SkSubmitter;
  period: VatPeriod;
  today?: Date;
}): string {
  // r01/r02 19 %, r01a/r02a 5 %, r03/r04 23 % — supplies taxed by us (§ 69 ods. 1).
  const out = { basic: { base: 0, vat: 0 }, reduced19: { base: 0, vat: 0 }, reduced5: { base: 0, vat: 0 } };
  for (const doc of input.issued) {
    if (classifySkIssued(doc) !== "domestic") continue;
    for (const [b, v] of byBand(doc.parts)) {
      out[b].base += v.base;
      out[b].vat += v.vat;
    }
  }
  // r18/r18a/r19 total deduction, r20/r20a/r21 the part from domestic invoices.
  const ded = { basic: 0, reduced19: 0, reduced5: 0 };
  for (const doc of input.received) {
    if (!deductible(doc)) continue;
    for (const [b, v] of byBand(doc.parts)) ded[b] += v.vat;
  }

  // Totals from the rounded rows, as the portal re-checks them.
  const r02 = cents(out.reduced19.vat);
  const r02a = cents(out.reduced5.vat);
  const r04 = cents(out.basic.vat);
  const r17 = cents(r02 + r02a + r04);
  const r18 = cents(ded.reduced19);
  const r18a = cents(ded.reduced5);
  const r19 = cents(ded.basic);
  const result = cents(r17 - r18 - r18a - r19);

  const period = input.period;
  const telo: [string, string][] = [
    ["r01", row(out.reduced19.base)],
    ["r01a", row(out.reduced5.base)],
    ["r02", row(r02)],
    ["r02a", row(r02a)],
    ["r03", row(out.basic.base)],
    ["r04", row(r04)],
    ...["r05", "r05a", "r06", "r06a", "r07", "r08", "r09", "r09a", "r09b", "r10", "r10a", "r10b"].map(
      (k) => [k, ""] as [string, string],
    ),
    ...["r11", "r11a", "r11b", "r11c", "r11d", "r11e", "r12", "r12a", "r12b", "r12c", "r12d", "r12e"].map(
      (k) => [k, ""] as [string, string],
    ),
    ...["r13", "r14", "r15", "r16"].map((k) => [k, ""] as [string, string]),
    ["r17", row(r17)],
    ["r18", row(r18)],
    ["r18a", row(r18a)],
    ["r19", row(r19)],
    ["r20", row(r18)],
    ["r20a", row(r18a)],
    ["r21", row(r19)],
    ...["r22", "r22a", "r23", "r23a", "r23b", "r23c", "r24", "r25", "r26", "r27", "r28", "r29", "r30", "r31"].map(
      (k) => [k, ""] as [string, string],
    ),
    // § 78: vlastná daňová povinnosť / nadmerný odpočet.
    ["r32", result > 0 ? eur(result) : ""],
    // Refund within 30 days under § 79 ods. 2 — the person ticks it in eDane.
    ["splneniePodmienok", "0"],
    ["r33", result < 0 ? eur(-result) : ""],
    ["r34", ""],
    ["r35", result > 0 ? eur(result) : ""],
    ["r36", ""],
    ["r37", ""],
  ];
  const s = input.submitter;
  return `<?xml version="1.0" encoding="UTF-8"?>
<dokument>
  <hlavicka>
    <identifikacneCislo><kodStatu>SK</kodStatu><cislo>${xml(vatNumber(s.icDph))}</cislo></identifikacneCislo>
    <dic></dic>
    <danovyUrad></danovyUrad>
    <nevzniklaPov>0</nevzniklaPov>
    <typDP><rdp>1</rdp><odp>0</odp><ddp>0</ddp><datumZisteniaDdp></datumZisteniaDdp></typDP>
    <osoba><platitel>1</platitel><registrovana>0</registrovana><inaPovinna>0</inaPovinna><zdanitelna>0</zdanitelna><zastupca>0</zastupca><zastupca69aa>0</zastupca69aa></osoba>
    <zdanObd><mesiac>${"month" in period ? period.month : ""}</mesiac><stvrtrok>${"quarter" in period ? period.quarter : ""}</stvrtrok><rok>${period.year}</rok></zdanObd>
    <meno>${nameLines(s.nazov, 4)
      .map((l) => `<riadok>${xml(l)}</riadok>`)
      .join("")}</meno>
    <adresa><ulica>${xml(s.ulica)}</ulica><cislo>${xml(s.cislo)}</cislo><psc>${xml(s.psc.replace(/\s/g, ""))}</psc><obec>${xml(s.obec)}</obec><telefon>${xml(s.telefon)}</telefon><email>${xml(s.email)}</email></adresa>
    <opravnenaOsoba><menoPriezvisko></menoPriezvisko><telefon></telefon><email></email></opravnenaOsoba>
    <datumVyhlasenia>${skDate(input.today ?? new Date())}</datumVyhlasenia>
  </hlavicka>
  <telo>
    ${telo.map(([k, v]) => `<${k}>${v}</${k}>`).join("\n    ")}
  </telo>
</dokument>
`;
}

/** Kontrolný výkaz DPH (KVDPHv25, § 78a), riadny. Due even when empty. */
export function generateSkKvDphV25(input: {
  issued: SkIssuedDoc[];
  received: SkReceivedDoc[];
  submitter: SkSubmitter;
  period: VatPeriod;
}): string {
  const a1: string[] = [];
  const a2: string[] = [];
  const c1: string[] = [];
  const odbAttr = (id: string | null) => (id ? ` Odb="${xml(compact(id))}"` : "");

  for (const doc of input.issued) {
    const kind = classifySkIssued(doc);
    if (kind !== "domestic" && kind !== "domestic_reverse") continue; // EU / foreign: SV only.
    const odb = kind === "domestic_reverse" || vatCountry(doc.customerVatId) === "SK" ? doc.customerVatId : null;
    if (kind === "domestic_reverse" && !odb) continue; // A.2 needs the customer's SK IČ DPH.
    const den = isoDate(doc.taxableDate);

    if (doc.correctsNumber) {
      // C.1: corrective invoice to an A.1 / A.2 invoice, one row per rate.
      if (kind === "domestic_reverse") {
        c1.push(
          `<C1${odbAttr(odb)} FO="${xml(docNo(doc.correctsNumber))}" FP="${xml(docNo(doc.number))}" ZR="${eur(baseOf(doc.parts))}" />`,
        );
      } else {
        for (const [b, v] of byBand(doc.parts)) {
          c1.push(
            `<C1${odbAttr(odb)} FO="${xml(docNo(doc.correctsNumber))}" FP="${xml(docNo(doc.number))}" ZR="${eur(v.base)}" DR="${eur(v.vat)}" S="${BAND_RATE[b]}" />`,
          );
        }
      }
      continue;
    }
    if (kind === "domestic_reverse") {
      // A.2: § 69 ods. 12 písm. f) až j), the customer pays the tax.
      a2.push(`<A2 Odb="${xml(compact(odb!))}" F="${xml(docNo(doc.number))}" Den="${den}" Z="${eur(baseOf(doc.parts))}" />`);
      continue;
    }
    // A.1: every invoice, no threshold; customers without an IČ DPH leave Odb empty.
    for (const [b, v] of byBand(doc.parts)) {
      a1.push(
        `<A1${odbAttr(odb)} F="${xml(docNo(doc.number))}" Den="${den}" Z="${eur(v.base)}" D="${eur(v.vat)}" S="${BAND_RATE[b]}" />`,
      );
    }
  }

  const b2: string[] = [];
  const simplified = { base: 0, vat: 0 };
  const simplifiedBySupplier = new Map<string, { base: number; vat: number }>();
  for (const doc of input.received) {
    if (!deductible(doc)) continue;
    const bands = byBand(doc.parts);
    if (vatCountry(doc.supplierVatId) === "SK" && doc.number.trim()) {
      // B.2: invoices from Slovak payers the tax is deducted from (O = deducted tax).
      for (const [b, v] of bands) {
        b2.push(
          `<B2 Dod="${xml(compact(doc.supplierVatId!))}" F="${xml(docNo(doc.number))}" Den="${isoDate(doc.taxableDate)}" Z="${eur(v.base)}" D="${eur(v.vat)}" S="${BAND_RATE[b]}" O="${eur(v.vat)}" />`,
        );
      }
      continue;
    }
    for (const v of bands.values()) {
      simplified.base += v.base;
      simplified.vat += v.vat;
      if (doc.supplierVatId) {
        const key = compact(doc.supplierVatId);
        const cur = simplifiedBySupplier.get(key) ?? { base: 0, vat: 0 };
        cur.base += v.base;
        cur.vat += v.vat;
        simplifiedBySupplier.set(key, cur);
      }
    }
  }

  // B.3.1 is one total; from € 3,000 of deducted tax B.3.2 lists suppliers
  // with an IČ DPH and only the rest stays in B.3.1.
  const b31: string[] = [];
  const b32: string[] = [];
  if (cents(simplified.vat) >= KV_SIMPLIFIED_THRESHOLD) {
    let rest = { ...simplified };
    for (const [dod, v] of simplifiedBySupplier) {
      b32.push(`<B32 Dod="${xml(dod)}" Z="${eur(v.base)}" D="${eur(v.vat)}" O="${eur(v.vat)}" />`);
      rest = { base: rest.base - v.base, vat: rest.vat - v.vat };
    }
    if (cents(rest.vat) !== 0) b31.push(`<B31 Z="${eur(rest.base)}" D="${eur(rest.vat)}" O="${eur(rest.vat)}" />`);
  } else if (cents(simplified.vat) !== 0) {
    b31.push(`<B31 Z="${eur(simplified.base)}" D="${eur(simplified.vat)}" O="${eur(simplified.vat)}" />`);
  }

  const s = input.submitter;
  const p = input.period;
  const opt = (tag: string, v: string) => (v ? `<${tag}>${xml(v)}</${tag}>` : "");
  const rows = [...a1, ...a2, ...b2, ...b31, ...b32, ...c1];
  return `<?xml version="1.0" encoding="UTF-8"?>
<KVDPH_2025 xmlns="${KV_NS}">
  <Identifikacia>
    <IcDphPlatitela>${xml(compact(s.icDph))}</IcDphPlatitela>
    <Druh>R</Druh>
    <Obdobie><Rok>${p.year}</Rok>${"month" in p ? `<Mesiac>${p.month}</Mesiac>` : `<Stvrtrok>${p.quarter}</Stvrtrok>`}</Obdobie>
    <Nazov>${xml(s.nazov)}</Nazov>
    <Stat>${xml(s.stat)}</Stat>
    <Obec>${xml(s.obec)}</Obec>
    ${[opt("PSC", s.psc.replace(/\s/g, "")), opt("Ulica", s.ulica), opt("Cislo", s.cislo), opt("Tel", s.telefon), opt("Email", s.email)].filter(Boolean).join("")}
  </Identifikacia>
  <Transakcie>${rows.length ? `\n    ${rows.join("\n    ")}\n  ` : ""}</Transakcie>
</KVDPH_2025>
`;
}

/**
 * Súhrnný výkaz (SVDPHv20, § 80): supplies to VAT-registered customers in
 * other EU states, one row per customer IČ DPH and supply code. Returns
 * null when there is nothing to report (no filing is due then).
 */
export function generateSkSvDphV20(input: {
  issued: SkIssuedDoc[];
  submitter: SkSubmitter;
  period: VatPeriod;
  today?: Date;
}): string | null {
  const rows = new Map<string, { country: string; id: string; value: number }>();
  for (const doc of input.issued) {
    if (classifySkIssued(doc) !== "eu" || !doc.customerVatId) continue;
    const raw = vatCountry(doc.customerVatId)!;
    const country = raw === "GR" ? "EL" : raw;
    const id = vatNumber(doc.customerVatId);
    const key = `${country}${id}`;
    const r = rows.get(key) ?? { country, id, value: 0 };
    r.value += baseOf(doc.parts);
    rows.set(key, r);
  }
  if (rows.size === 0) return null;

  const list = [...rows.values()];
  const total = list.reduce((sum, r) => sum + Math.round(r.value), 0);
  const pages: string[] = [];
  for (let i = 0; i < list.length; i += SV_ROWS_PER_PAGE) {
    const chunk = list.slice(i, i + SV_ROWS_PER_PAGE);
    const zaznam = Array.from({ length: SV_ROWS_PER_PAGE }, (_, j) => {
      const r = chunk[j];
      // Code 2 = services under § 15 ods. 1 (see the header comment).
      return r
        ? `<zaznam><kodStatu>${r.country}</kodStatu><idCislo>${xml(r.id)}</idCislo><hodnota>${Math.round(r.value)}</hodnota><kod>2</kod></zaznam>`
        : `<zaznam><kodStatu></kodStatu><idCislo></idCislo><hodnota></hodnota><kod></kod></zaznam>`;
    });
    const cast2 = Array.from(
      { length: SV_ROWS_PER_PAGE },
      () =>
        `<zaznamCast2><kodStatu></kodStatu><idCislo></idCislo><idCislo2></idCislo2><vratenieTovaru></vratenieTovaru><oprava></oprava></zaznamCast2>`,
    );
    pages.push(`<strana>\n      ${[...zaznam, ...cast2].join("\n      ")}\n    </strana>`);
  }

  const s = input.submitter;
  const p = input.period;
  const today = input.today ?? new Date();
  return `<?xml version="1.0" encoding="UTF-8"?>
<dokument>
  <hlavicka>
    <identifikacneCislo><kodStatu>SK</kodStatu><dic>${xml(vatNumber(s.icDph))}</dic></identifikacneCislo>
    <danovyUrad></danovyUrad>
    <druhSV><riadny>true</riadny><opravny></opravny><dodatocny></dodatocny></druhSV>
    <obdobie><mesiac>${"month" in p ? pad(p.month) : ""}</mesiac><stvrtrok>${"quarter" in p ? p.quarter : ""}</stvrtrok><rok>${p.year}</rok></obdobie>
    <obchodneMeno>${nameLines(s.nazov, 4, true)
      .map((l) => `<riadok>${xml(l)}</riadok>`)
      .join("")}</obchodneMeno>
    <adresa><ulica>${xml(s.ulica)}</ulica><cislo>${xml(s.cislo)}</cislo><psc>${xml(s.psc.replace(/\s/g, ""))}</psc><obec>${xml(s.obec)}</obec><tel>${xml(s.telefon)}</tel><email>${xml(s.email)}</email></adresa>
    <celkovaHodnota>${total}</celkovaHodnota>
    <konatel></konatel>
    <datumVyhlasenia><den>${pad(today.getDate())}</den><mesiac>${pad(today.getMonth() + 1)}</mesiac><rok>${today.getFullYear()}</rok></datumVyhlasenia>
  </hlavicka>
  <telo>
    ${pages.join("\n    ")}
  </telo>
</dokument>
`;
}

/** Splits a name into the form's name lines (36 characters each on the paper form). */
function nameLines(name: string, max: number, exact = false): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= 36) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  // Too long for the lines: keep the rest on the last one rather than lose it.
  if (lines.length > max) lines.splice(max - 1, lines.length, lines.slice(max - 1).join(" "));
  if (lines.length === 0) lines.push("");
  while (exact && lines.length < max) lines.push("");
  return lines;
}

/** Builds the submitter block from the company's settings. */
export function skSubmitterFromTenant(t: {
  legalName: string;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  email: string | null;
  phone: string | null;
}): SkSubmitter {
  // "Hlavná 12/3a" → street and number (súpisné/orientačné kept together).
  const street = (t.addressStreet ?? "").trim();
  const m = street.match(/^(.*?)[\s,]+(\d+[\w/]*)$/);
  return {
    icDph: compact(t.dic ?? ""),
    nazov: t.legalName.trim(),
    ulica: m ? m[1]! : street,
    cislo: m ? m[2]! : "",
    psc: t.addressPostalCode ?? "",
    obec: t.addressCity ?? "",
    stat: "Slovenská republika",
    telefon: t.phone ?? "",
    email: t.email ?? "",
  };
}
