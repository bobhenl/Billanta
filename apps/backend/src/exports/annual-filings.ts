/**
 * Yearly filings of a Czech sole trader, prefilled from the company's own
 * invoices: the income tax return (DPFO, EPO form DPFDP), the přehled for
 * ČSSZ (ePortál XML) and the values for the health insurer's přehled.
 *
 * Only the typical case is covered: § 7 income from one activity, actual or
 * flat-rate expenses, the basic taxpayer credit (optionally the spouse
 * credit), and paid advances. Children, deductions (§ 15), other income,
 * losses from earlier years, sickness insurance and working pensioners are
 * left for the person to add in EPO / the ČSSZ form. Nothing is filed from
 * here: the person reviews the file and submits it themselves.
 *
 * Pure functions; amounts in CZK.
 */
import { czTaxYear, OSVC_FLAT_EXPENSE_CAPS, type OsvcFlatRate } from "@faktur/cz-compliance";
import { dicNumber, header, xmlAttr, type VatSubmitter } from "./vat-returns";
import type { AccountingBasis } from "./annual-summary";

export class FormNotPublishedError extends Error {
  constructor(readonly form: string, readonly year: number) {
    super("form_not_published");
  }
}

// Rounded to haléře first so float noise does not add a crown.
const roundUp = (n: number) => Math.ceil(Math.round(Math.max(0, n) * 100) / 100);
const floorHundreds = (n: number) => Math.floor(Math.max(0, n) / 100) * 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

function yearOrThrow(year: number) {
  const y = czTaxYear(year);
  if (!y) throw new FormNotPublishedError("parameters", year);
  return y;
}

// ── DPFO ────────────────────────────────────────────────────────────────

/**
 * EPO forms by tax year, from the MF form list
 * (https://adisspr.mfcr.cz/dpr/adis/idpr_pub/epo2_info/popis_struktury_seznam.faces):
 * DPFDP7 01.01.02 covers 2024 and 2025, DPFDP6 03.01.01 covers 2021 to 2023.
 * `verzePis` takes the first two parts of the version, as for DPHKH1 03.01.
 * No form for 2026 exists yet (filed in 2027).
 */
export const DPFDP_FORMS: { years: [number, number]; form: string; dokument: string; verzePis: string }[] = [
  { years: [2021, 2023], form: "DPFDP6", dokument: "DP6", verzePis: "03.01" },
  { years: [2024, 2025], form: "DPFDP7", dokument: "DP7", verzePis: "01.01" },
];

export function dpfdpFormFor(year: number) {
  return DPFDP_FORMS.find((f) => year >= f.years[0] && year <= f.years[1]) ?? null;
}

export interface DpfoInput {
  year: number;
  income: number;
  actualExpenses: number;
  flatRate: OsvcFlatRate | null;
  basis: AccountingBasis;
  /** Income tax advances paid during the year (ř. 84). */
  taxAdvancesPaid?: number;
  /** Claim the spouse credit (§ 35ba (1) b) ZDP, ř. 65a). */
  spouseCredit?: boolean;
  /** Months the activity ran (příloha 1, m_podnik). */
  months?: number;
}

/** The lines of the DAP the typical case fills, keyed by row number. */
export function computeDpfo(input: DpfoInput) {
  const y = yearOrThrow(input.year);
  const income = Math.round(Math.max(0, input.income));
  const expenses = Math.round(
    input.flatRate
      ? Math.min(income * (input.flatRate / 100), OSVC_FLAT_EXPENSE_CAPS[input.flatRate])
      : Math.max(0, input.actualExpenses),
  );
  const r104 = income - expenses;
  const r113 = r104;
  // A loss from § 7 (ř. 113 below zero) goes to ř. 61 as dílčí ztráta; the base is then zero.
  const r37 = r113;
  const r41 = Math.max(0, r37);
  const r42 = r41;
  const r45 = r42;
  const r54 = 0;
  const r55 = Math.max(0, r45 - r54);
  const r56 = floorHundreds(r55);
  // § 16 ZDP: 15 %, 23 % above 36× (2023: 48×) the average wage.
  const threshold = y.taxHighMultiple * y.averageWage;
  const r57 = round2(Math.min(r56, threshold) * 0.15 + Math.max(0, r56 - threshold) * 0.23);
  const r58 = r57;
  const r60 = roundUp(r58);
  const r61 = r37 < 0 ? -r37 : 0;
  const r64 = y.taxpayerCredit;
  const r65a = input.spouseCredit ? y.spouseCredit : 0;
  const r70 = r64 + r65a;
  const r71 = Math.max(0, r60 - r70);
  const r74 = r71;
  const r75 = r74;
  const r77 = r75;
  const r84 = Math.round(Math.max(0, input.taxAdvancesPaid ?? 0));
  const r91 = r77 - r84;
  return {
    year: input.year,
    basis: input.basis,
    flatRate: input.flatRate,
    months: input.months ?? 12,
    rows: { r101: income, r102: expenses, r104, r113, r37, r41, r42, r45, r54, r55, r56, r57, r58, r60, r61, r64, r65a, r70, r71, r74, r75, r77, r84, r91 },
  };
}

export type DpfoLines = ReturnType<typeof computeDpfo>;

export interface FilingPerson {
  submitter: VatSubmitter;
  /** Rodné číslo without the slash. Never stored; typed in for the download. */
  birthNumber?: string;
  /** Date of birth, YYYY-MM-DD (ČSSZ). */
  birthDate?: string;
  /** Finanční úřad code (c_ufo_cil, 4 digits) and územní pracoviště (c_pracufo). */
  taxOffice?: number;
  taxWorkplace?: number;
  /** ID datové schránky (ČSSZ). */
  dataBox?: string;
}

function attrs(pairs: [string, string | number | null | undefined][]) {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== 0)
    .map(([k, v]) => `${k}="${xmlAttr(String(v))}"`)
    .join(" ");
}

/** EPO XML of the DAP (DPFDP6 / DPFDP7). Throws FormNotPublishedError for a year without a form. */
export function generateDpfdp(lines: DpfoLines, person: FilingPerson): string {
  const form = dpfdpFormFor(lines.year);
  if (!form) throw new FormNotPublishedError("DPFDP", lines.year);
  const r = lines.rows;
  const s = person.submitter;
  const vetaD = attrs([
    ["dokument", form.dokument],
    ["k_uladis", "DPF"],
    ["dap_typ", "B"],
    ["rok", lines.year],
    ["c_ufo_cil", person.taxOffice],
    ["pln_moc", "N"],
    ["audit", "N"],
    ["zdobd_od", `01.01.${lines.year}`],
    ["zdobd_do", `31.12.${lines.year}`],
    ["da_slezap", r.r58.toFixed(2)],
    ["da_celod13", r.r60],
    ["kc_dztrata", r.r61],
    ["kc_op15_1a", r.r64],
    ["kc_op15_1c", r.r65a],
    ["uhrn_slevy35ba", r.r70],
    ["da_slevy35ba", r.r71],
    ["da_slevy35c", r.r74],
    ["kc_dan_celk", r.r75],
    ["kc_dan_po_db", r.r77],
    ["kc_zalpred", r.r84],
    ["kc_zbyvpred", r.r91],
  ]);
  const vetaP = attrs([
    ["dic", s.dic ? dicNumber(s.dic) : null],
    ["rod_c", person.birthNumber?.replace(/\D/g, "")],
    ["jmeno", s.jmeno],
    ["prijmeni", s.prijmeni],
    ["naz_obce", s.obec],
    ["ulice", s.ulice],
    ["c_pop", s.cPop.replace(/\D/g, "")],
    ["c_orient", s.cOrient],
    ["psc", s.psc.replace(/\s/g, "")],
    ["k_stat", "CZ"],
    ["stat", s.stat],
    ["email", s.email],
    ["c_telef", s.telefon],
    ["c_pracufo", person.taxWorkplace],
  ]);
  const vetaO = attrs([
    ["kc_zd7", r.r37],
    ["kc_uhrn", r.r41],
    ["kc_zakldan23", r.r42],
    ["kc_zakldan", r.r45],
  ]);
  const vetaS = attrs([
    ["kc_odcelk", r.r54],
    ["kc_zdsniz", r.r55],
    ["kc_zdzaokr", r.r56],
    ["da_dan16", r.r57.toFixed(2)],
  ]);
  const vetaT = attrs([
    ["kc_prij7", r.r101],
    ["kc_vyd7", r.r102],
    ["kc_hosp_rozd", r.r104],
    ["kc_zd7p", r.r113],
    ["vyd7proc", lines.flatRate ? "A" : "N"],
    ["uc_soust", lines.basis === "accrual" ? "2" : "1"],
    ["m_podnik", lines.months],
    ...(lines.flatRate
      ? ([
          ["pr_sazba", lines.flatRate],
          ["pr_prij7", r.r101],
          ["pr_vyd7", r.r102],
          ["celk_pr_prij7", r.r101],
          ["celk_pr_vyd7", r.r102],
        ] as [string, number][])
      : []),
  ]);
  return `${header("41.21.1")}
<${form.form} verzePis="${form.verzePis}">
  <VetaD ${vetaD} />
  <VetaP ${vetaP} />
  <VetaO ${vetaO} />
  <VetaS ${vetaS} />
  <VetaB priloha1="1" />
  <VetaT ${vetaT} />
</${form.form}>
</Pisemnost>
`;
}

// ── Přehled ČSSZ ────────────────────────────────────────────────────────

/**
 * ePortál ČSSZ XML schemas by year, from https://www.cssz.gov.cz/definice-e-podani-osvc
 * (OSVC2023, OSVC2024, OSVC2025). The 2026 one comes out in early 2027.
 */
export const CSSZ_OSVC_YEARS = [2023, 2024, 2025] as const;

export interface CsszInput {
  year: number;
  /** Tax base from § 7 (ř. 113 of the DAP, ř. 20 here). */
  profit: number;
  /** H = hlavní (main), V = vedlejší (secondary) activity. */
  activity: "H" | "V";
  /** Months with the activity, 1–12 (default all). */
  months?: number[];
  /** Social advances paid for the year (ř. 33). */
  paidAdvances: number;
}

/** Rows 20–36 of the přehled, following ČSSZ's "zadání pro programátory" for 2025. */
export function computeCssz(input: CsszInput) {
  const y = yearOrThrow(input.year);
  const months = [...new Set((input.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  const n = months.length;
  const main = input.activity === "H";
  const r20 = Math.max(0, Math.round(input.profit));
  const r23 = n ? round2(r20 / n) : 0;
  const r24 = round2(r23 * n);
  const r25 = roundUp(r24 * y.socialBaseShare);
  const maxBase = y.socialMaxMultiple * y.averageWage;
  const minMonthly = roundUp(y.averageWage * (main ? y.social.annualMainShare : y.social.secondaryShare));
  // Secondary activity is insured only when its base reaches the rozhodná
  // částka, reduced by a twelfth for each month without the activity.
  const threshold = y.social.secondaryThreshold - (12 - n) * roundUp(y.social.secondaryThreshold / 12);
  const insured = n > 0 && (main || r24 >= threshold);
  const r27 = insured ? minMonthly * n : 0;
  const r26 = insured ? Math.min(Math.max(r25, r27), maxBase) : 0;
  const r28 = r26;
  const r31 = r28;
  const r32 = roundUp(r31 * 0.292);
  const r33 = Math.round(Math.max(0, input.paidAdvances));
  const r34 = r32 - r33;
  // Next year's advance: this year's base per month, at least next year's
  // minimum as due when the přehled is filed (May).
  const next = czTaxYear(input.year + 1);
  const nextShare = next ? (next.social.mainShareFrom && 5 >= next.social.mainShareFrom.fromMonth ? next.social.mainShareFrom.share : next.social.mainShare) : null;
  const nextMin = next && nextShare != null ? roundUp(next.averageWage * (main ? nextShare : next.social.secondaryShare)) : 0;
  const r35 = insured && n ? Math.max(roundUp(r31 / n), nextMin) : 0;
  const r36 = r35 ? roundUp(r35 * 0.292) : 0;
  return {
    year: input.year,
    activity: input.activity,
    months,
    insured,
    rows: { r20, r21: n, r22: n, r23, r24, r25, r26, r27, r28, r31, r32, r33, r34, r35, r36 },
    nextMinimumKnown: next != null,
  };
}

export type CsszLines = ReturnType<typeof computeCssz>;

const yn = (v: boolean) => (v ? "A" : "");

/** ePortál XML of the přehled (OSVC2023–2025). Throws FormNotPublishedError for other years. */
export function generateCsszOsvc(lines: CsszLines, person: FilingPerson & { variableSymbol?: string; ossz?: string }, today = new Date()): string {
  if (!(CSSZ_OSVC_YEARS as readonly number[]).includes(lines.year)) throw new FormNotPublishedError("OSVC", lines.year);
  const s = person.submitter;
  const r = lines.rows;
  const main = lines.activity === "H";
  const whole = lines.months.length === 12;
  const monthTags = (on: boolean) =>
    Array.from({ length: 12 }, (_, i) => `<m${i + 1}>${on && !whole && lines.months.includes(i + 1) ? "A" : ""}</m${i + 1}>`).join("") +
    `<m13>${on && whole ? "A" : ""}</m13>`;
  const withDiscount = lines.year >= 2025;
  const e = (v: string | number | undefined | null) => xmlAttr(v == null ? "" : String(v));
  const street = [s.cPop, s.cOrient].filter(Boolean).join("/");
  const hv = (v: number) => (main ? `h="${v}" v=""` : `h="" v="${v}"`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<OSVC xmlns="http://schemas.cssz.cz/OSVC${lines.year}" version="1.0">
  <VENDOR productName="Billanta" productVersion="1.0" />
  <SENDER EmailNotifikace="${e(s.email)}" ISDSreport="3" VerzeProtokolu="1" />
  <prehledosvc vsdp="${e(person.variableSymbol)}" for="prehledosvc" dep="${e(person.ossz)}" rok="${lines.year}" typ="N" dat="">
    <client>
      <name fir="${e(s.jmeno)}" sur="${e(s.prijmeni)}" tit="" />
      <birth bno="${e(person.birthNumber?.replace(/\D/g, ""))}" den="${e(person.birthDate)}" />
      <adr cit="${e(s.obec)}" cnt="CZ" num="${e(street)}" pnu="${e(s.psc.replace(/\s/g, ""))}" str="${e(s.ulice)}" />
      <idds>${e(person.dataBox)}</idds>
      <email>${e(s.email)}</email>
      <tel>${e(s.telefon)}</tel>
      <druc>${lines.activity}</druc>
      <hlavc>${monthTags(main)}</hlavc>
      <vedc>${monthTags(!main)}</vedc>
      <narok>${monthTags(false)}</narok>${withDiscount ? `\n      <sleva>${monthTags(false)}</sleva>` : ""}
    </client>
    <pvv pri="${r.r20}">
      <mesc ${hv(r.r21)} />
      <mesv ${hv(r.r22)} />
      <mesp>${r.r23.toFixed(2)}</mesp>
      <rdza ${hv(r.r24)} />
      <vvz ${hv(lines.insured ? r.r25 : 0)} />
      <dvz ${hv(r.r26)} />
      <mvz>${r.r27}</mvz>
      <uvz>${r.r28}</uvz>
      <vzza />
      <vzsu>${r.r28}</vzsu>
      <vzsvc>${r.r31}</vzsvc>
      <poj>${r.r32}</poj>${withDiscount ? `\n      <slev>0</slev>\n      <pojposlev>${r.r32}</pojposlev>` : ""}
      <zal>${r.r33}</zal>
      <ned>${r.r34}</ned>
    </pvv>
    <prihldp />
    <zal ved="${lines.activity}" pau="" vz="${r.r35}" dp="${r.r36}" np="0"${withDiscount ? ' duch=""' : ""} />
    <pre vra="${r.r34 < 0 ? -r.r34 : 0}" kam="">
      <rok />
      <iban />
      <bs pu="" cu="" kb="" ss="" vs="" />
      <adr str="" num="" pnu="" cit="" cnt="" />
    </pre>
    <prizn>
      <pau />
      <pov>A</pov>
      <elektr>N</elektr>
      <por>N</por>
      <meldat />
    </prizn>
    <opr datopr="" duvod="" />
    <spo bno="" den="">
      <name sur="" fir="" tit="" />
      <adr str="" num="" pnu="" cit="" cnt="" />
    </spo>
    <dat dre="${today.toISOString().slice(0, 10)}" />
  </prehledosvc>
</OSVC>
`;
}

// ── Přehled pro zdravotní pojišťovnu ────────────────────────────────────

/**
 * The seven Czech health insurers. Each uses its own přehled form (PDF or
 * its own portal); none publishes an import format we could verify, so the
 * app shows the values to copy instead of a file.
 */
export const HEALTH_INSURERS = [
  { code: "111", name: "Všeobecná zdravotní pojišťovna ČR" },
  { code: "201", name: "Vojenská zdravotní pojišťovna ČR" },
  { code: "205", name: "Česká průmyslová zdravotní pojišťovna" },
  { code: "207", name: "Oborová zdravotní pojišťovna" },
  { code: "209", name: "Zaměstnanecká pojišťovna Škoda" },
  { code: "211", name: "Zdravotní pojišťovna ministerstva vnitra ČR" },
  { code: "213", name: "RBP, zdravotní pojišťovna" },
] as const;

export interface HealthInput {
  year: number;
  profit: number;
  /** Months of self-employment (minimum base applies per month). */
  months?: number;
  paidAdvances: number;
}

/** The values of the health přehled: base 50 % of profit, at least the monthly minimum × months, 13.5 %. */
export function computeHealth(input: HealthInput) {
  const y = yearOrThrow(input.year);
  const months = Math.min(12, Math.max(0, input.months ?? 12));
  const profit = Math.max(0, Math.round(input.profit));
  const baseFromProfit = roundUp(profit * 0.5);
  const minMonthly = roundUp(y.averageWage * y.healthMinShare);
  const minBase = minMonthly * months;
  const base = Math.max(baseFromProfit, minBase);
  const premium = roundUp(base * 0.135);
  const paid = Math.round(Math.max(0, input.paidAdvances));
  const next = czTaxYear(input.year + 1);
  const nextMin = next ? roundUp(roundUp(next.averageWage * next.healthMinShare) * 0.135) : null;
  const nextAdvance = months ? Math.max(roundUp((base / months) * 0.135), nextMin ?? 0) : 0;
  return { year: input.year, months, profit, baseFromProfit, minBase, base, premium, paid, balance: premium - paid, nextAdvance, nextMinimumKnown: nextMin != null };
}

export const FILING_DISCLAIMER =
  "Předvyplněno z dokladů v aplikaci. Před podáním vše zkontrolujte; podání provádíte sami přes EPO, ePortál ČSSZ, portál pojišťovny nebo datovou schránku.";
