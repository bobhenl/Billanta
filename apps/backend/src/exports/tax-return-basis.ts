import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import PDFDocument from "pdfkit";
import type { TaxReturnBasis } from "@faktur/cz-compliance";
import { csvNumber as csvAmount, csvText } from "./csv-cell";

/**
 * "Podklady pro daňové přiznání" as files for the accountant: a CSV sheet and
 * a one-to-two page PDF. The figures come from `computeTaxReturnBasis`
 * (@faktur/cz-compliance) over the year's own documents; this file only lays
 * them out. Czech for a Czech company, Slovak for a Slovak one: the files go
 * to the accountant and the tax office of that country.
 */
export interface TaxReturnReport extends TaxReturnBasis {
  companyName: string;
  /** cash = by the day paid (daňová evidence), accrual = by DUZP (účetnictví). */
  basis: "cash" | "accrual";
  vatPayer: boolean;
  /** Settings → the company is in the paušální režim (CZ). */
  flatTaxRegime: boolean;
  counts: { invoices: number; expenses: number; missingRates: number };
}

type Lang = "cs" | "sk";
const langOf = (r: Pick<TaxReturnReport, "country">): Lang => (r.country === "SK" ? "sk" : "cs");

const CATEGORY: Record<Lang, Record<string, string>> = {
  cs: {
    material: "Materiál",
    services: "Služby",
    software: "Software",
    travel: "Cestovné",
    fuel: "Pohonné hmoty",
    office: "Kancelář",
    telecom: "Telefon a internet",
    rent: "Nájem",
    marketing: "Marketing",
    other: "Ostatní",
  },
  sk: {
    material: "Materiál",
    services: "Služby",
    software: "Softvér",
    travel: "Cestovné",
    fuel: "Pohonné hmoty",
    office: "Kancelária",
    telecom: "Telefón a internet",
    rent: "Nájom",
    marketing: "Marketing",
    other: "Ostatné",
  },
};

const T = {
  cs: {
    title: (y: number) => `Podklady pro daňové přiznání ${y}`,
    company: "Firma",
    year: "Zdaňovací období",
    basisLabel: "Evidence",
    basis: { cash: "daňová evidence – podle data úhrady", accrual: "účetnictví – podle DUZP" },
    vatPayer: "Plátce DPH",
    vatPayerValue: (v: boolean) => (v ? "ano – částky bez DPH" : "ne – částky včetně DPH"),
    income: "Příjmy z uhrazených faktur (po odečtení dobropisů)",
    incomeAccrual: "Příjmy z vystavených faktur (po odečtení dobropisů)",
    documents: (i: number, e: number) => `${i} dokladů příjmů, ${e} výdajů`,
    missingRates: (n: number) => `${n} dokladů v cizí měně bez kurzu nezapočteno`,
    expensesHead: "Výdaje podle kategorií",
    uncategorised: "Bez kategorie",
    actualTotal: "Skutečné výdaje celkem",
    flatHead: "Výdajové paušály (§ 7 odst. 7 ZDP)",
    flatRow: (rate: number, cap: string) => `Paušál ${rate} % (max. ${cap})`,
    capped: "strop",
    chosenHead: (rate: number) => `Paušál ${rate} % vs. skutečné výdaje`,
    better: { flat: "Vyšší výdaje dává paušál.", actual: "Vyšší výdaje dávají skutečné výdaje.", equal: "Obě varianty vycházejí stejně." },
    estimateHead: "Orientační odhad daně a pojistného",
    option: { flat_expenses: "S paušálem", actual_expenses: "Se skutečnými výdaji", flat_tax: "Paušální daň" },
    expenses: "Výdaje",
    profit: "Zisk",
    tax: "Daň z příjmů (po slevě na poplatníka)",
    social: "Sociální pojištění",
    health: "Zdravotní pojištění",
    total: "Celkem za rok",
    flatTaxHead: "Paušální daň",
    flatTaxBand: (band: number) => `${band}. pásmo`,
    flatTaxNo: { vat_payer: "Nelze – plátce DPH.", over_limit: "Nelze – příjmy nad limitem 2 mil. Kč.", no_data: "Pro tento rok chybí parametry." },
    best: { flat_tax: "Nejlevněji vychází paušální daň.", flat_expenses: "Nejlevněji vychází paušál.", actual_expenses: "Nejlevněji vycházejí skutečné výdaje." },
    noParams: (y: number) => `Pro rok ${y} zatím nemáme zveřejněné sazby a limity, odhad daně proto chybí.`,
    deadlinesHead: "Termíny podání přiznání",
    deadline: {
      paper: "Listinně",
      electronic: "Elektronicky",
      advisor: "S daňovým poradcem (plná moc do 1. 4.)",
      extended: "Prodloužená lhůta",
    },
    notesHead: "Poznámky",
    notes: {
      insurance: "Pojistné OSVČ na sociální a zdravotní pojištění není daňový výdaj (§ 25 ZDP).",
      flatTaxRegime: "Jste v paušálním režimu: přiznání k dani z příjmů ani přehledy obvykle nepodáváte, pokud jste v roce režim neopustili.",
      legalEntity: "Společnost podává přiznání k dani z příjmů právnických osob (DPPO); paušály ani paušální daň se na ni nevztahují. Výsledek hospodaření určuje účetnictví.",
      estimate: "Odhad počítá jen se slevou na poplatníka, bez dalších slev, odpočtů a příjmů z jiných zdrojů (zaměstnání, nájem).",
    },
    notAdvice: "Podklad pro daňové přiznání z vašich dokladů, nejde o daňové poradenství.",
    disclaimer:
      "Soubor vytvořila aplikace Billanta z údajů v ní zadaných. Má jen informativní charakter, je bez záruky a nenahrazuje daňového poradce ani účetní. Před podáním všechny údaje ověřte; za obsah podání odpovídáte vy.",
    yes: "ano",
    no: "ne",
    file: (y: number) => `podklady-dap-${y}`,
  },
  sk: {
    title: (y: number) => `Podklady k daňovému priznaniu ${y}`,
    company: "Firma",
    year: "Zdaňovacie obdobie",
    basisLabel: "Evidencia",
    basis: { cash: "daňová evidencia – podľa dátumu úhrady", accrual: "účtovníctvo – podľa dátumu dodania" },
    vatPayer: "Platiteľ DPH",
    vatPayerValue: (v: boolean) => (v ? "áno – sumy bez DPH" : "nie – sumy vrátane DPH"),
    income: "Príjmy z uhradených faktúr (po odpočítaní dobropisov)",
    incomeAccrual: "Príjmy z vystavených faktúr (po odpočítaní dobropisov)",
    documents: (i: number, e: number) => `${i} dokladov príjmov, ${e} výdavkov`,
    missingRates: (n: number) => `${n} dokladov v cudzej mene bez kurzu nezapočítaných`,
    expensesHead: "Výdavky podľa kategórií",
    uncategorised: "Bez kategórie",
    actualTotal: "Skutočné výdavky spolu",
    flatHead: "Paušálne výdavky (§ 6 ods. 10 ZDP)",
    flatRow: (rate: number, cap: string) => `Paušál ${rate} % (max. ${cap})`,
    capped: "strop",
    chosenHead: (rate: number) => `Paušál ${rate} % vs. skutočné výdavky`,
    better: { flat: "Vyššie výdavky dáva paušál.", actual: "Vyššie výdavky dávajú skutočné výdavky.", equal: "Obe možnosti vychádzajú rovnako." },
    estimateHead: "Orientačný odhad dane a odvodov",
    option: { flat_expenses: "S paušálom", actual_expenses: "So skutočnými výdavkami", flat_tax: "Paušálna daň" },
    expenses: "Výdavky",
    profit: "Zisk",
    tax: "Daň z príjmov",
    social: "Sociálne poistenie zaplatené v roku",
    health: "Zdravotné poistenie za rok",
    total: "Spolu za rok",
    flatTaxHead: "Paušálna daň",
    flatTaxBand: (band: number) => `${band}. pásmo`,
    flatTaxNo: { vat_payer: "Nie – platiteľ DPH.", over_limit: "Nie – príjmy nad limitom.", no_data: "Pre tento rok chýbajú parametre." },
    best: { flat_tax: "", flat_expenses: "Lacnejšie vychádza paušál.", actual_expenses: "Lacnejšie vychádzajú skutočné výdavky." },
    noParams: (y: number) => `Pre rok ${y} zatiaľ nemáme zverejnené sadzby a limity, odhad dane preto chýba.`,
    deadlinesHead: "Termíny podania priznania",
    deadline: {
      paper: "Riadny termín",
      electronic: "Elektronicky",
      advisor: "S daňovým poradcom",
      extended: "Po oznámení o predĺžení lehoty (§ 49 ods. 3 ZDP)",
    },
    notesHead: "Poznámky",
    notes: {
      insurance: "Zaplatené sociálne a zdravotné poistenie si odpočítate popri paušáli aj skutočných výdavkoch (§ 6 ods. 10 a 11 ZDP).",
      flatTaxRegime: "",
      legalEntity: "Spoločnosť podáva daňové priznanie právnickej osoby (DPPO); paušálne výdavky sa na ňu nevzťahujú. Výsledok hospodárenia určuje účtovníctvo.",
      estimate: "Odhad počíta len s nezdaniteľnou časťou na daňovníka, bez ďalších odpočtov, daňového bonusu a príjmov z iných zdrojov.",
    },
    notAdvice: "Podklad k daňovému priznaniu z vašich dokladov, nejde o daňové poradenstvo.",
    disclaimer:
      "Súbor vytvorila aplikácia Billanta z údajov v nej zadaných. Má len informatívny charakter, je bez záruky a nenahrádza daňového poradcu ani účtovníka. Pred podaním všetky údaje overte; za obsah podania zodpovedáte vy.",
    yes: "áno",
    no: "nie",
    file: (y: number) => `podklady-dp-${y}`,
  },
} as const;

/** File name without the extension, ASCII only. */
export const taxReturnFileName = (r: Pick<TaxReturnReport, "country" | "year">) => T[langOf(r)].file(r.year);

const csvNumber = (v: number | null | undefined) => (v == null ? "" : csvAmount(v));
const ymd = (d: Date) => `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
// Plain spaces: pdfkit's Helvetica fallback has no NBSP / narrow NBSP glyphs.
const money = (v: number | null | undefined, currency: "CZK" | "EUR") =>
  v == null
    ? "–"
    : new Intl.NumberFormat(currency === "EUR" ? "sk-SK" : "cs-CZ", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 })
        .format(v)
        .replace(/[  ]/g, " ");

const categoryLabel = (lang: Lang, c: string | null) => (c == null ? T[lang].uncategorised : (CATEGORY[lang][c] ?? c));

type Section = { head: string; rows: [string, string][] };

/** The report as titled sections of label – value rows: shared by the CSV and the PDF. */
export function taxReturnSections(r: TaxReturnReport, format: (v: number | null | undefined) => string): Section[] {
  const t = T[langOf(r)];
  const lang = langOf(r);
  const sections: Section[] = [];
  const head: [string, string][] = [
    [t.company, r.companyName],
    [t.year, String(r.year)],
    [t.basisLabel, t.basis[r.basis]],
    [t.vatPayer, t.vatPayerValue(r.vatPayer)],
    [r.basis === "accrual" ? t.incomeAccrual : t.income, format(r.income)],
    [t.actualTotal, format(r.actualExpenses)],
    ["", t.documents(r.counts.invoices, r.counts.expenses)],
  ];
  if (r.counts.missingRates) head.push(["", t.missingRates(r.counts.missingRates)]);
  sections.push({ head: t.title(r.year), rows: head });

  sections.push({
    head: t.expensesHead,
    rows: [...r.categories.map((c) => [categoryLabel(lang, c.category), format(c.amount)] as [string, string]), [t.actualTotal, format(r.actualExpenses)]],
  });

  if (!r.legalEntity) {
    sections.push({
      head: t.flatHead,
      rows: r.flatExpenses.map((f) => [t.flatRow(f.rate, format(f.cap)), f.capped ? `${format(f.amount)} (${t.capped})` : format(f.amount)]),
    });
    if (r.chosen) {
      sections.push({
        head: t.chosenHead(r.chosen.rate),
        rows: [
          [t.option.flat_expenses, format(r.chosen.flat)],
          [t.option.actual_expenses, format(r.chosen.actual)],
          ["", t.better[r.chosen.better]],
        ],
      });
    }
    if (r.options) {
      const rows: [string, string][] = [];
      for (const o of r.options) {
        rows.push(
          [`${t.option[o.kind]} – ${t.expenses}`, format(o.expenses)],
          [`${t.option[o.kind]} – ${t.profit}`, format(o.profit)],
          [`${t.option[o.kind]} – ${t.tax}`, format(o.tax)],
          ...(o.social != null ? ([[`${t.option[o.kind]} – ${t.social}`, format(o.social)]] as [string, string][]) : []),
          [`${t.option[o.kind]} – ${t.health}`, format(o.health)],
          [`${t.option[o.kind]} – ${t.total}`, format(o.total)],
        );
      }
      sections.push({ head: t.estimateHead, rows });
    } else {
      sections.push({ head: t.estimateHead, rows: [["", t.noParams(r.year)]] });
    }
    if (r.flatTax) {
      const ft = r.flatTax.options.find((o) => o.kind === "flat_tax")!;
      const rows: [string, string][] = ft.available
        ? [
            [t.flatTaxBand(ft.band!), format(ft.total)],
            ["", t.best[r.flatTax.best]],
          ]
        : [["", t.flatTaxNo[ft.reason ?? "no_data"]]];
      sections.push({ head: t.flatTaxHead, rows });
    }
  }

  sections.push({ head: t.deadlinesHead, rows: r.deadlines.map((d) => [t.deadline[d.kind], ymd(d.date)]) });

  const notes: string[] = [];
  if (r.legalEntity) notes.push(t.notes.legalEntity);
  else {
    notes.push(t.notes.insurance);
    if (r.flatTaxRegime && t.notes.flatTaxRegime) notes.push(t.notes.flatTaxRegime);
    if (r.options) notes.push(t.notes.estimate);
  }
  notes.push(t.notAdvice);
  sections.push({ head: t.notesHead, rows: notes.map((n) => ["", n]) });
  return sections;
}

/** Semicolon CSV with a BOM, like the other exports (Excel in CZ/SK opens it as is). */
export function taxReturnCsv(r: TaxReturnReport): string {
  const t = T[langOf(r)];
  // The sections are already strings: a cell that is exactly a formatted amount stays a number
  // (a negative profit must not get the ' prefix); anything else, e.g. a free-text category, is defused.
  const cell = (v: string) => (/^-?\d+(?:,\d+)?$/.test(v) ? v : csvText(v));
  const lines: string[] = [];
  for (const s of taxReturnSections(r, csvNumber)) {
    if (lines.length) lines.push("");
    lines.push(cell(s.head));
    for (const [k, v] of s.rows) lines.push(`${cell(k)};${cell(v)}`);
  }
  lines.push("", `${cell(t.disclaimer)}`);
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// DejaVu Sans covers č/ř/ě/ů/ľ/ô; Helvetica (WinAnsi) stays as a fallback, as in invoice-pdf.service.ts.
function resolveFonts(): { regular: string; bold: string } | null {
  try {
    const dir = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
    const regular = join(dir, "DejaVuSans.ttf");
    const bold = join(dir, "DejaVuSans-Bold.ttf");
    return existsSync(regular) && existsSync(bold) ? { regular, bold } : null;
  } catch {
    return null;
  }
}
const FONTS = resolveFonts();
const REGULAR = FONTS ? "Body" : "Helvetica";
const BOLD = FONTS ? "Body-Bold" : "Helvetica-Bold";

export function taxReturnPdf(r: TaxReturnReport): Promise<Buffer> {
  const t = T[langOf(r)];
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: t.title(r.year), Creator: "Billanta" } });
  if (FONTS) {
    doc.registerFont(REGULAR, FONTS.regular);
    doc.registerFont(BOLD, FONTS.bold);
  }
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const valueWidth = 150;
  const format = (v: number | null | undefined) => money(v, r.currency);
  const sections = taxReturnSections(r, format);

  doc.font(BOLD).fontSize(16).fillColor("#111827").text(sections[0]!.head, left, doc.y, { width });
  doc.moveDown(0.2);
  doc.font(REGULAR).fontSize(8.5).fillColor("#6b7280").text(t.notAdvice, { width });
  doc.moveDown(0.6);

  sections.forEach((s, i) => {
    if (i > 0) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 60) doc.addPage();
      doc.moveDown(0.6);
      doc.font(BOLD).fontSize(11).fillColor("#111827").text(s.head, left, doc.y, { width });
      doc.moveDown(0.25);
    }
    for (const [k, v] of s.rows) {
      const y = doc.y;
      doc.font(REGULAR).fontSize(9.5).fillColor("#111827");
      if (!k) {
        doc.fillColor("#374151").text(v, left, y, { width });
      } else {
        doc.text(k, left, y, { width: width - valueWidth - 10 });
        const after = doc.y;
        doc.text(v, left + width - valueWidth, y, { width: valueWidth, align: "right" });
        doc.y = Math.max(after, doc.y);
      }
      doc.moveDown(0.15);
    }
  });

  doc.moveDown(1);
  doc.font(REGULAR).fontSize(7.5).fillColor("#6b7280").text(t.disclaimer, left, doc.y, { width });
  doc.end();
  return finished;
}
