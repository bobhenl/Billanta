import { addDays, addHours, daysAgo, daysFromNow } from "./dates";
import { SUPPLIERS, type DemoKind } from "./kinds";

export interface DemoLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  /** null for a supplier that is not a VAT payer. */
  vatRate: number | null;
}

/**
 * What the document should look like when the visitor opens the demo. The
 * seeder gets there through InvoicesService (create, issue, markPaid,
 * cancel, convert), so numbering, snapshots and totals are the real ones.
 */
export type DemoInvoiceState =
  | "draft"
  | "ai_draft"
  | "issued"
  | "partial"
  | "paid"
  | "cancelled"
  | "quote_open"
  | "quote_accepted"
  | "quote_rejected"
  | "quote_expired";

export interface DemoInvoice {
  key: string;
  contactKey: string;
  documentType: "invoice" | "proforma" | "credit_note" | "quote";
  state: DemoInvoiceState;
  issueDate: Date;
  /** Due date; for a quote, the "valid until" date. */
  dueDate: Date;
  currency: string;
  /** Home currency per 1 unit of `currency`; null in the home currency. */
  exchangeRate: number | null;
  language: "cs" | "sk" | "en";
  reverseCharge: boolean;
  reverseChargeCode: string | null;
  lines: DemoLine[];
  paidAt: Date | null;
  /** Paid so far, for `partial`. */
  partialAmount: number | null;
  sentAt: Date | null;
  /** Made with InvoicesService.convert from this earlier document. */
  convertFrom: string | null;
  noteAbove: string | null;
  respondedAt: Date | null;
  ai: { transcript: string; confidence: string } | null;
}

// A converted document may leave out `lines`: it takes them from its source.
type Spec = Partial<DemoInvoice> & Pick<DemoInvoice, "key" | "contactKey" | "state" | "issueDate">;

function line(description: string, quantity: number, unitPrice: number, vatRate: number | null, unit: string | null = null): DemoLine {
  return { description, quantity, unit, unitPrice, vatRate };
}

function finish(kind: DemoKind, spec: Spec): DemoInvoice {
  const sup = SUPPLIERS[kind];
  const issued = !["draft", "ai_draft"].includes(spec.state);
  return {
    documentType: "invoice",
    dueDate: addDays(spec.issueDate, 14),
    currency: sup.home,
    exchangeRate: null,
    language: sup.language,
    reverseCharge: false,
    reverseChargeCode: null,
    paidAt: null,
    partialAmount: null,
    // Sent the same afternoon; nothing is ever e-mailed from a demo, the
    // timestamp only makes the list look lived in.
    sentAt: issued && spec.state !== "cancelled" ? addHours(spec.issueDate, 4) : null,
    convertFrom: null,
    noteAbove: null,
    respondedAt: null,
    ai: null,
    lines: [],
    ...spec,
  };
}

function czVatSro(now: Date): Spec[] {
  const v = 21;
  return [
    {
      key: "bar",
      contactKey: "kavarna",
      state: "paid",
      issueDate: daysAgo(now, 75),
      paidAt: daysAgo(now, 66),
      lines: [line("Výroba barového pultu – dubová dýha", 1, 148_000, v, "ks"), line("Doprava a montáž", 1, 9_500, v)],
    },
    {
      key: "bar_credit",
      contactKey: "kavarna",
      documentType: "credit_note",
      convertFrom: "bar",
      state: "paid",
      issueDate: daysAgo(now, 58),
      paidAt: daysAgo(now, 57),
      noteAbove: "Opravný daňový doklad. Důvod opravy: sleva za posunutý termín montáže.",
      lines: [line("Sleva za posunutý termín montáže", -1, 5_000, v)],
    },
    {
      key: "office",
      contactKey: "atelier",
      state: "paid",
      issueDate: daysAgo(now, 60),
      paidAt: daysAgo(now, 49),
      lines: [
        line("Pracovní stůl na míru 180 × 80 cm", 4, 18_900, v, "ks"),
        line("Skříňka pod stůl, tři zásuvky", 4, 6_400, v, "ks"),
        line("Montáž", 6, 850, v, "hod"),
      ],
    },
    {
      key: "kitchen",
      contactKey: "horakova",
      state: "issued",
      issueDate: daysAgo(now, 79),
      dueDate: daysAgo(now, 65),
      lines: [line("Kuchyňská linka – masivní dub, 3,2 m", 1, 86_400, v, "ks"), line("Zaměření a montáž", 1, 7_200, v)],
    },
    {
      key: "hotel_rc",
      contactKey: "javor",
      state: "issued",
      issueDate: daysAgo(now, 34),
      dueDate: daysAgo(now, 20),
      reverseCharge: true,
      reverseChargeCode: "4",
      noteAbove: "Montáž obkladů v rámci zakázky Hotel Javorový dvůr, 2. patro.",
      lines: [line("Montáž dřevěných obkladů stěn", 64, 1_150, v, "m²"), line("Montáž zakázkových dveří", 6, 3_800, v, "ks")],
    },
    {
      key: "shelves",
      contactKey: "kavarna",
      state: "issued",
      issueDate: daysAgo(now, 17),
      dueDate: daysAgo(now, 3),
      lines: [line("Nástěnné police – ořech", 5, 2_900, v, "ks")],
    },
    {
      key: "reception",
      contactKey: "atelier",
      state: "partial",
      issueDate: daysAgo(now, 10),
      dueDate: daysFromNow(now, 4),
      partialAmount: 30_000,
      paidAt: daysAgo(now, 5),
      lines: [line("Recepční pult s osvětlením", 1, 52_000, v, "ks"), line("Montáž", 1, 4_500, v)],
    },
    {
      key: "stairs_open",
      contactKey: "javor",
      state: "issued",
      issueDate: daysAgo(now, 5),
      dueDate: daysFromNow(now, 9),
      lines: [line("Obložení schodiště – dubové stupně", 14, 3_400, v, "ks"), line("Zábradlí – ocel a dub", 1, 21_000, v)],
    },
    {
      key: "eur_sk",
      contactKey: "tatranska",
      state: "paid",
      issueDate: daysAgo(now, 45),
      paidAt: daysAgo(now, 33),
      currency: "EUR",
      exchangeRate: 24.32,
      language: "sk",
      reverseCharge: true,
      lines: [line("Návrh interiéru recepcie a lobby", 1, 2_800, v), line("Vizualizácie (3 varianty)", 3, 240, v, "ks")],
    },
    {
      key: "eur_de",
      contactKey: "holzwerk",
      state: "issued",
      issueDate: daysAgo(now, 12),
      dueDate: daysFromNow(now, 2),
      currency: "EUR",
      exchangeRate: 24.35,
      language: "en",
      reverseCharge: true,
      lines: [line("CNC milling of oak panels (subcontract)", 38, 42, v, "h")],
    },
    {
      key: "gbp",
      contactKey: "kestrel",
      state: "paid",
      issueDate: daysAgo(now, 50),
      paidAt: daysAgo(now, 40),
      currency: "GBP",
      exchangeRate: 29.1,
      language: "en",
      reverseCharge: true,
      lines: [line("Interior design consultation – studio fit-out", 12, 85, v, "h")],
    },
    {
      key: "proforma",
      contactKey: "atelier",
      documentType: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 30),
      dueDate: daysAgo(now, 23),
      paidAt: daysAgo(now, 25),
      lines: [line("Záloha 50 % – knihovna přes celou stěnu", 1, 39_000, v)],
    },
    {
      key: "proforma_final",
      contactKey: "atelier",
      convertFrom: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 24),
    },
    {
      key: "cancelled",
      contactKey: "novotny",
      state: "cancelled",
      issueDate: daysAgo(now, 70),
      lines: [line("Vestavěná skříň do předsíně", 1, 31_500, v, "ks")],
    },
    {
      key: "quote_open",
      contactKey: "javor",
      documentType: "quote",
      state: "quote_open",
      issueDate: daysAgo(now, 3),
      dueDate: daysFromNow(now, 27),
      lines: [line("Obložení restaurace – 3. etapa", 1, 186_000, v), line("Barový pult", 1, 64_000, v, "ks")],
    },
    {
      key: "quote_accepted",
      contactKey: "kavarna",
      documentType: "quote",
      state: "quote_accepted",
      issueDate: daysAgo(now, 25),
      dueDate: daysFromNow(now, 5),
      respondedAt: daysAgo(now, 22),
      lines: [line("Venkovní lavice – modřín", 6, 7_800, v, "ks")],
    },
    {
      key: "quote_rejected",
      contactKey: "novotny",
      documentType: "quote",
      state: "quote_rejected",
      issueDate: daysAgo(now, 40),
      dueDate: daysAgo(now, 10),
      respondedAt: daysAgo(now, 35),
      lines: [line("Dětský pokoj na míru – postel, skříň, stůl", 1, 92_000, v)],
    },
    {
      key: "quote_expired",
      contactKey: "bluewater",
      documentType: "quote",
      state: "quote_expired",
      issueDate: daysAgo(now, 50),
      dueDate: daysAgo(now, 20),
      currency: "USD",
      exchangeRate: 22.95,
      language: "en",
      reverseCharge: true,
      lines: [line("Custom walnut conference table, 4 m", 1, 9_800, v, "pcs"), line("Crating and shipping", 1, 1_400, v)],
    },
    {
      key: "draft",
      contactKey: "javor",
      state: "draft",
      issueDate: daysAgo(now, 0),
      lines: [line("Schodišťové madlo – dub", 12, 1_250, v, "m")],
    },
    {
      key: "ai",
      contactKey: "kavarna",
      state: "ai_draft",
      issueDate: daysAgo(now, 0),
      ai: {
        transcript: "Faktura pro kavárnu U Tří lamp, oprava osmi židlí po pěti stech, plus doprava tisíc korun.",
        confidence: "0.720",
      },
      lines: [line("Oprava židlí", 8, 500, v, "ks"), line("Doprava", 1, 1_000, v)],
    },
  ];
}

/** The non-payer CZ kinds share the shape; only the trade differs. */
function czNonPayer(now: Date, trade: "design" | "dev"): Spec[] {
  const d = trade === "design";
  const n = null;
  return [
    {
      key: "paid1",
      contactKey: d ? "atelier" : "javor",
      state: "paid",
      issueDate: daysAgo(now, 70),
      paidAt: daysAgo(now, 62),
      lines: d
        ? [line("Návrh loga a základní vizuální identity", 1, 18_000, n)]
        : [line("Vývoj rezervačního systému – 1. etapa", 48, 950, n, "hod")],
    },
    {
      key: "paid2",
      contactKey: "kavarna",
      state: "paid",
      issueDate: daysAgo(now, 55),
      paidAt: daysAgo(now, 47),
      lines: d
        ? [line("Jídelní lístek – grafická úprava", 1, 7_500, n), line("Plakáty A2", 4, 1_250, n, "ks")]
        : [line("Úprava webu – online menu", 14, 950, n, "hod")],
    },
    {
      key: "paid2_credit",
      contactKey: "kavarna",
      documentType: "credit_note",
      convertFrom: "paid2",
      state: "paid",
      issueDate: daysAgo(now, 44),
      paidAt: daysAgo(now, 43),
      noteAbove: "Opravný doklad. Důvod opravy: jedna položka nebyla dodána.",
      lines: d ? [line("Plakáty A2", -1, 1_250, n, "ks")] : [line("Úprava webu – online menu", -2, 950, n, "hod")],
    },
    {
      key: "overdue65",
      contactKey: "horakova",
      state: "issued",
      issueDate: daysAgo(now, 79),
      dueDate: daysAgo(now, 65),
      lines: d
        ? [line("Svatební oznámení – návrh", 1, 3_800, n), line("Tisk oznámení", 80, 32.5, n, "ks")]
        : [line("Nastavení e-shopu a import produktů", 1, 6_400, n)],
    },
    {
      key: "overdue20",
      contactKey: d ? "javor" : "atelier",
      state: "issued",
      issueDate: daysAgo(now, 34),
      dueDate: daysAgo(now, 20),
      lines: d
        ? [line("Redesign webu – 2. etapa", 1, 28_000, n)]
        : [line("Napojení na platební bránu", 22, 950, n, "hod")],
    },
    {
      key: "overdue3",
      contactKey: d ? "atelier" : "javor",
      state: "issued",
      issueDate: daysAgo(now, 17),
      dueDate: daysAgo(now, 3),
      lines: d
        ? [line("Ilustrace do výroční zprávy", 7, 1_400, n, "ks")]
        : [line("Správa serveru – měsíční paušál", 1, 3_500, n)],
    },
    {
      key: "partial",
      contactKey: d ? "javor" : "atelier",
      state: "partial",
      issueDate: daysAgo(now, 12),
      dueDate: daysFromNow(now, 2),
      partialAmount: 12_000,
      paidAt: daysAgo(now, 6),
      lines: d
        ? [line("Fotografie interiérů hotelu", 1, 24_000, n)]
        : [line("Mobilní aplikace – prototyp", 26, 950, n, "hod")],
    },
    {
      key: "open",
      contactKey: "kavarna",
      state: "issued",
      issueDate: daysAgo(now, 4),
      dueDate: daysFromNow(now, 10),
      lines: d ? [line("Vizitky – návrh", 1, 4_200, n)] : [line("Opravy chyb po spuštění", 5, 950, n, "hod")],
    },
    {
      key: "eur",
      contactKey: "nordlicht",
      state: "paid",
      issueDate: daysAgo(now, 40),
      paidAt: daysAgo(now, 30),
      currency: "EUR",
      exchangeRate: 24.32,
      language: "en",
      lines: d
        ? [line("Book cover design – 'Stille Wasser'", 1, 650, n)]
        : [line("Backend development – content API", 30, 45, n, "h")],
    },
    d
      ? {
          key: "usd",
          contactKey: "bluewater",
          state: "issued",
          issueDate: daysAgo(now, 20),
          dueDate: daysFromNow(now, 6),
          currency: "USD",
          exchangeRate: 22.95,
          language: "en",
          lines: [line("Brand guidelines – 24-page manual", 1, 1_200, n)],
        }
      : {
          key: "gbp",
          contactKey: "kestrel",
          state: "issued",
          issueDate: daysAgo(now, 20),
          dueDate: daysFromNow(now, 6),
          currency: "GBP",
          exchangeRate: 29.1,
          language: "en",
          lines: [line("Website performance audit", 1, 780, n)],
        },
    {
      key: "proforma",
      contactKey: "atelier",
      documentType: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 28),
      dueDate: daysAgo(now, 21),
      paidAt: daysAgo(now, 23),
      lines: d
        ? [line("Záloha – katalog podzimní kolekce", 1, 15_000, n)]
        : [line("Záloha – migrace na nový hosting", 1, 12_000, n)],
    },
    { key: "proforma_final", contactKey: "atelier", convertFrom: "proforma", state: "paid", issueDate: daysAgo(now, 22) },
    {
      key: "cancelled",
      contactKey: "novotny",
      state: "cancelled",
      issueDate: daysAgo(now, 66),
      lines: d ? [line("Portrétní fotografie", 1, 3_500, n)] : [line("Instalace a nastavení NAS", 1, 2_800, n)],
    },
    {
      key: "quote_open",
      contactKey: d ? "javor" : "atelier",
      documentType: "quote",
      state: "quote_open",
      issueDate: daysAgo(now, 2),
      dueDate: daysFromNow(now, 28),
      lines: d
        ? [line("Kompletní vizuální identita hotelu", 1, 64_000, n)]
        : [line("Klientský portál – odhad", 120, 950, n, "hod")],
    },
    {
      key: "quote_accepted",
      contactKey: "kavarna",
      documentType: "quote",
      state: "quote_accepted",
      issueDate: daysAgo(now, 26),
      dueDate: daysFromNow(now, 4),
      respondedAt: daysAgo(now, 21),
      lines: d ? [line("Nový jídelní lístek – jaro", 1, 8_000, n)] : [line("Věrnostní program na webu", 32, 950, n, "hod")],
    },
    {
      key: "quote_rejected",
      contactKey: "novotny",
      documentType: "quote",
      state: "quote_rejected",
      issueDate: daysAgo(now, 42),
      dueDate: daysAgo(now, 12),
      respondedAt: daysAgo(now, 37),
      lines: d ? [line("Logo pro rodinnou pekárnu", 1, 12_000, n)] : [line("Webová stránka pro řemeslníka", 1, 18_000, n)],
    },
    {
      key: "quote_expired",
      contactKey: "horakova",
      documentType: "quote",
      state: "quote_expired",
      issueDate: daysAgo(now, 48),
      dueDate: daysAgo(now, 18),
      lines: d ? [line("Fotokniha – grafická úprava", 1, 5_500, n)] : [line("Domácí síť a zálohování", 1, 4_900, n)],
    },
    {
      key: "draft",
      contactKey: d ? "atelier" : "javor",
      state: "draft",
      issueDate: daysAgo(now, 0),
      lines: d ? [line("Infografika – výroční zpráva", 3, 2_200, n, "ks")] : [line("Programování – říjen", 18, 950, n, "hod")],
    },
    {
      key: "ai",
      contactKey: "kavarna",
      state: "ai_draft",
      issueDate: daysAgo(now, 0),
      ai: d
        ? { transcript: "Fakturu pro kavárnu U Tří lamp za návrh letáku, tři tisíce dvě stě korun.", confidence: "0.810" }
        : { transcript: "Fakturu kavárně U Tří lamp, šest hodin úprav webu po devíti stech padesáti.", confidence: "0.780" },
      lines: d ? [line("Návrh letáku", 1, 3_200, n)] : [line("Úpravy webu", 6, 950, n, "hod")],
    },
  ];
}

function skVatSro(now: Date): Spec[] {
  const v = 23;
  return [
    {
      key: "team1",
      contactKey: "tatranska",
      state: "paid",
      issueDate: daysAgo(now, 72),
      paidAt: daysAgo(now, 63),
      lines: [line("Teambuilding v Nízkych Tatrách – 24 osôb", 24, 89, v, "os."), line("Doprava autobusom", 1, 640, v)],
    },
    {
      key: "team1_credit",
      contactKey: "tatranska",
      documentType: "credit_note",
      convertFrom: "team1",
      state: "paid",
      issueDate: daysAgo(now, 56),
      paidAt: daysAgo(now, 55),
      noteAbove: "Opravná faktúra. Dôvod opravy: zúčastnilo sa o dve osoby menej.",
      lines: [line("Teambuilding v Nízkych Tatrách – 24 osôb", -2, 89, v, "os.")],
    },
    {
      key: "wedding",
      contactKey: "kovac",
      state: "paid",
      issueDate: daysAgo(now, 58),
      paidAt: daysAgo(now, 50),
      lines: [line("Organizácia svadby – koordinácia v deň D", 1, 1_200, v), line("Výzdoba sály", 1, 450, v)],
    },
    {
      key: "overdue65",
      contactKey: "balaz",
      state: "issued",
      issueDate: daysAgo(now, 79),
      dueDate: daysAgo(now, 65),
      lines: [line("Oslava 50. narodenín – organizácia", 1, 780, v)],
    },
    {
      key: "overdue20",
      contactKey: "tatranska",
      state: "issued",
      issueDate: daysAgo(now, 34),
      dueDate: daysAgo(now, 20),
      lines: [line("Firemný večierok – program a moderátor", 1, 1_850, v)],
    },
    {
      key: "overdue3",
      contactKey: "kovac",
      state: "issued",
      issueDate: daysAgo(now, 17),
      dueDate: daysAgo(now, 3),
      lines: [line("Fotograf na podujatie", 5, 60, v, "hod")],
    },
    {
      key: "partial",
      contactKey: "tatranska",
      state: "partial",
      issueDate: daysAgo(now, 11),
      dueDate: daysFromNow(now, 3),
      partialAmount: 1_000,
      paidAt: daysAgo(now, 4),
      lines: [line("Zimný výstup na Chopok – sprievodcovia", 3, 320, v, "deň"), line("Požičanie výstroja", 18, 25, v, "ks")],
    },
    {
      key: "open",
      contactKey: "kovac",
      state: "issued",
      issueDate: daysAgo(now, 5),
      dueDate: daysFromNow(now, 9),
      lines: [line("Rozlúčka so slobodou – rafting na Dunajci", 10, 55, v, "os.")],
    },
    {
      key: "rc_cz",
      contactKey: "javor",
      state: "paid",
      issueDate: daysAgo(now, 46),
      paidAt: daysAgo(now, 35),
      language: "cs",
      reverseCharge: true,
      lines: [line("Příprava firemního výletu do Vysokých Tater", 1, 1_400, v)],
    },
    {
      key: "czk",
      contactKey: "atelier",
      state: "issued",
      issueDate: daysAgo(now, 13),
      dueDate: daysFromNow(now, 1),
      currency: "CZK",
      exchangeRate: 0.0398,
      language: "cs",
      reverseCharge: true,
      lines: [line("Koordinace fotografování v Tatrách", 1, 38_000, v)],
    },
    {
      key: "at",
      contactKey: "bergquelle",
      state: "paid",
      issueDate: daysAgo(now, 38),
      paidAt: daysAgo(now, 29),
      language: "en",
      reverseCharge: true,
      lines: [line("Guided hiking programme – High Tatras, 3 days", 1, 2_250, v)],
    },
    {
      key: "gbp",
      contactKey: "kestrel",
      state: "issued",
      issueDate: daysAgo(now, 19),
      dueDate: daysFromNow(now, 11),
      currency: "GBP",
      exchangeRate: 1.17,
      language: "en",
      reverseCharge: true,
      lines: [line("Location scouting for a photo shoot", 2, 380, v, "day")],
    },
    {
      key: "proforma",
      contactKey: "tatranska",
      documentType: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 29),
      dueDate: daysAgo(now, 22),
      paidAt: daysAgo(now, 24),
      lines: [line("Záloha – vianočný večierok", 1, 1_500, v)],
    },
    { key: "proforma_final", contactKey: "tatranska", convertFrom: "proforma", state: "paid", issueDate: daysAgo(now, 23) },
    {
      key: "cancelled",
      contactKey: "balaz",
      state: "cancelled",
      issueDate: daysAgo(now, 64),
      lines: [line("Výlet na Štrbské pleso – rodina", 1, 420, v)],
    },
    {
      key: "quote_open",
      contactKey: "tatranska",
      documentType: "quote",
      state: "quote_open",
      issueDate: daysAgo(now, 3),
      dueDate: daysFromNow(now, 27),
      lines: [line("Letný teambuilding – 40 osôb, 2 dni", 40, 145, v, "os.")],
    },
    {
      key: "quote_accepted",
      contactKey: "kovac",
      documentType: "quote",
      state: "quote_accepted",
      issueDate: daysAgo(now, 24),
      dueDate: daysFromNow(now, 6),
      respondedAt: daysAgo(now, 20),
      lines: [line("Oslava výročia – catering a program", 1, 1_900, v)],
    },
    {
      key: "quote_rejected",
      contactKey: "balaz",
      documentType: "quote",
      state: "quote_rejected",
      issueDate: daysAgo(now, 41),
      dueDate: daysAgo(now, 11),
      respondedAt: daysAgo(now, 36),
      lines: [line("Splav Hrona – 12 osôb", 12, 48, v, "os.")],
    },
    {
      key: "quote_expired",
      contactKey: "bergquelle",
      documentType: "quote",
      state: "quote_expired",
      issueDate: daysAgo(now, 52),
      dueDate: daysAgo(now, 22),
      language: "en",
      reverseCharge: true,
      lines: [line("Ski week for a group of 16 – programme", 1, 4_800, v)],
    },
    {
      key: "draft",
      contactKey: "tatranska",
      state: "draft",
      issueDate: daysAgo(now, 0),
      lines: [line("Vianočný večierok – doplatok", 1, 2_300, v)],
    },
    {
      key: "ai",
      contactKey: "kovac",
      state: "ai_draft",
      issueDate: daysAgo(now, 0),
      ai: {
        transcript: "Faktúra pre Mareka Kováča, sprievodca na celý deň za tristo eur.",
        confidence: "0.740",
      },
      lines: [line("Sprievodca – celý deň", 1, 300, v, "deň")],
    },
  ];
}

/**
 * A translator who is not a VAT payer. Foreign clients sit outside the EU:
 * a service to a business in another member state would make her register
 * for VAT (§7a ZoDPH).
 */
function skFreelancer(now: Date): Spec[] {
  const n = null;
  return [
    {
      key: "paid1",
      contactKey: "povazie",
      state: "paid",
      issueDate: daysAgo(now, 71),
      paidAt: daysAgo(now, 60),
      lines: [line("Preklad technickej dokumentácie lisovacej linky EN → SK", 64, 18, n, "NS")],
    },
    {
      key: "paid2",
      contactKey: "zobor",
      state: "paid",
      issueDate: daysAgo(now, 54),
      paidAt: daysAgo(now, 47),
      lines: [line("Preklad e-shopu vinárstva SK → DE", 22, 20, n, "NS"), line("Jazyková korektúra rodeným hovoriacim", 1, 90, n)],
    },
    {
      key: "paid2_credit",
      contactKey: "zobor",
      documentType: "credit_note",
      convertFrom: "paid2",
      state: "paid",
      issueDate: daysAgo(now, 44),
      paidAt: daysAgo(now, 43),
      noteAbove: "Opravný doklad. Dôvod opravy: dve normostrany sa nakoniec neprekladali.",
      lines: [line("Preklad e-shopu vinárstva SK → DE", -2, 20, n, "NS")],
    },
    {
      key: "overdue65",
      contactKey: "balaz",
      state: "issued",
      issueDate: daysAgo(now, 79),
      dueDate: daysAgo(now, 65),
      lines: [line("Preklad životopisu a motivačného listu do angličtiny", 3, 18, n, "NS")],
    },
    {
      key: "overdue20",
      contactKey: "tatranska",
      state: "issued",
      issueDate: daysAgo(now, 34),
      dueDate: daysAgo(now, 20),
      lines: [line("Preklad webu chaty do nemčiny a poľštiny", 1, 680, n)],
    },
    {
      key: "overdue3",
      contactKey: "kovac",
      state: "issued",
      issueDate: daysAgo(now, 17),
      dueDate: daysAgo(now, 3),
      lines: [line("Jazyková korektúra diplomovej práce", 1, 140, n)],
    },
    {
      key: "partial",
      contactKey: "povazie",
      state: "partial",
      issueDate: daysAgo(now, 12),
      dueDate: daysFromNow(now, 2),
      partialAmount: 700,
      paidAt: daysAgo(now, 5),
      lines: [line("Preklad návodu na obsluhu CNC stroja EN → SK", 85, 18, n, "NS")],
    },
    {
      key: "open",
      contactKey: "zobor",
      state: "issued",
      issueDate: daysAgo(now, 4),
      dueDate: daysFromNow(now, 10),
      lines: [line("Preklad etikiet a technických listov vín", 12, 20, n, "NS")],
    },
    {
      key: "gbp",
      contactKey: "kestrel",
      state: "paid",
      issueDate: daysAgo(now, 40),
      paidAt: daysAgo(now, 31),
      currency: "GBP",
      exchangeRate: 1.17,
      language: "en",
      lines: [line("Translation of a photo book, Slovak to English", 1, 520, n)],
    },
    {
      key: "usd",
      contactKey: "bluewater",
      state: "issued",
      issueDate: daysAgo(now, 20),
      dueDate: daysFromNow(now, 6),
      currency: "USD",
      exchangeRate: 0.86,
      language: "en",
      lines: [line("Localisation of a booking app into Slovak and Czech", 1, 900, n)],
    },
    {
      key: "proforma",
      contactKey: "tatranska",
      documentType: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 28),
      dueDate: daysAgo(now, 21),
      paidAt: daysAgo(now, 23),
      lines: [line("Záloha – preklad propagačných materiálov na zimnú sezónu", 1, 400, n)],
    },
    { key: "proforma_final", contactKey: "tatranska", convertFrom: "proforma", state: "paid", issueDate: daysAgo(now, 22) },
    {
      key: "cancelled",
      contactKey: "balaz",
      state: "cancelled",
      issueDate: daysAgo(now, 66),
      lines: [line("Preklad listu pre rakúsky úrad", 1, 60, n)],
    },
    {
      key: "quote_open",
      contactKey: "povazie",
      documentType: "quote",
      state: "quote_open",
      issueDate: daysAgo(now, 2),
      dueDate: daysFromNow(now, 28),
      lines: [line("Preklad katalógu náhradných dielov – odhad", 140, 17, n, "NS")],
    },
    {
      key: "quote_accepted",
      contactKey: "zobor",
      documentType: "quote",
      state: "quote_accepted",
      issueDate: daysAgo(now, 26),
      dueDate: daysFromNow(now, 4),
      respondedAt: daysAgo(now, 21),
      lines: [line("Preklad výročnej správy do angličtiny", 1, 560, n)],
    },
    {
      key: "quote_rejected",
      contactKey: "kovac",
      documentType: "quote",
      state: "quote_rejected",
      issueDate: daysAgo(now, 42),
      dueDate: daysAgo(now, 12),
      respondedAt: daysAgo(now, 37),
      lines: [line("Tlmočenie na svadbe – celý deň", 1, 350, n, "deň")],
    },
    {
      key: "quote_expired",
      contactKey: "tatranska",
      documentType: "quote",
      state: "quote_expired",
      issueDate: daysAgo(now, 48),
      dueDate: daysAgo(now, 18),
      lines: [line("Preklad jedálneho lístka do troch jazykov", 1, 240, n)],
    },
    {
      key: "draft",
      contactKey: "povazie",
      state: "draft",
      issueDate: daysAgo(now, 0),
      lines: [line("Preklad bezpečnostných listov – október", 18, 18, n, "NS")],
    },
    {
      key: "ai",
      contactKey: "zobor",
      state: "ai_draft",
      issueDate: daysAgo(now, 0),
      ai: {
        transcript: "Faktúra pre vinárstvo Pod Zoborom, preklad cenníka, šesť normostrán po dvadsať eur.",
        confidence: "0.790",
      },
      lines: [line("Preklad cenníka", 6, 20, n, "NS")],
    },
  ];
}

/**
 * An electrician who is a VAT payer. Installation work for another payer is
 * a construction supply, so the customer self-assesses the VAT (§69 ods. 12
 * písm. j ZoDPH); an inspection or work for a household carries 23 %.
 */
function skVatFreelancer(now: Date): Spec[] {
  const v = 23;
  return [
    {
      key: "hall",
      contactKey: "gazdovska",
      state: "paid",
      issueDate: daysAgo(now, 73),
      paidAt: daysAgo(now, 61),
      reverseCharge: true,
      lines: [line("Elektroinštalácia výrobnej haly – práce", 64, 32, v, "hod"), line("Inštalačný materiál a rozvádzač", 1, 1_480, v)],
    },
    {
      key: "flat",
      contactKey: "kovac",
      state: "paid",
      issueDate: daysAgo(now, 57),
      paidAt: daysAgo(now, 49),
      lines: [line("Rekonštrukcia elektroinštalácie v byte", 1, 2_400, v), line("Svietidlá vrátane montáže", 6, 45, v, "ks")],
    },
    {
      key: "flat_credit",
      contactKey: "kovac",
      documentType: "credit_note",
      convertFrom: "flat",
      state: "paid",
      issueDate: daysAgo(now, 45),
      paidAt: daysAgo(now, 44),
      noteAbove: "Opravná faktúra. Dôvod opravy: zľava za posunutý termín dokončenia.",
      lines: [line("Zľava za posunutý termín dokončenia", -1, 150, v)],
    },
    {
      key: "overdue65",
      contactKey: "balaz",
      state: "issued",
      issueDate: daysAgo(now, 79),
      dueDate: daysAgo(now, 65),
      lines: [line("Oprava elektroinštalácie v rodinnom dome", 1, 680, v), line("Výjazd", 1, 25, v)],
    },
    {
      key: "overdue20",
      contactKey: "tatranska",
      state: "issued",
      issueDate: daysAgo(now, 34),
      dueDate: daysAgo(now, 20),
      reverseCharge: true,
      lines: [line("Osvetlenie terasy – rozvody a montáž", 1, 1_950, v)],
    },
    {
      key: "overdue3",
      contactKey: "zobor",
      state: "issued",
      issueDate: daysAgo(now, 17),
      dueDate: daysAgo(now, 3),
      lines: [line("Odborná prehliadka a skúška elektroinštalácie", 1, 320, v)],
    },
    {
      key: "partial",
      contactKey: "gazdovska",
      state: "partial",
      issueDate: daysAgo(now, 11),
      dueDate: daysFromNow(now, 3),
      partialAmount: 1_500,
      paidAt: daysAgo(now, 4),
      reverseCharge: true,
      lines: [line("Pripojenie nových pecí – práce a materiál", 1, 2_600, v)],
    },
    {
      key: "open",
      contactKey: "kovac",
      state: "issued",
      issueDate: daysAgo(now, 5),
      dueDate: daysFromNow(now, 9),
      lines: [line("Inštalácia nabíjacej stanice pre elektromobil", 1, 890, v)],
    },
    {
      key: "proforma",
      contactKey: "balaz",
      documentType: "proforma",
      state: "paid",
      issueDate: daysAgo(now, 30),
      dueDate: daysAgo(now, 23),
      paidAt: daysAgo(now, 25),
      lines: [line("Záloha – elektroinštalácia v novostavbe", 1, 1_500, v)],
    },
    { key: "proforma_final", contactKey: "balaz", convertFrom: "proforma", state: "paid", issueDate: daysAgo(now, 24) },
    {
      key: "cancelled",
      contactKey: "zobor",
      state: "cancelled",
      issueDate: daysAgo(now, 68),
      lines: [line("Výmena rozvádzača v pivnici", 1, 740, v)],
    },
    {
      key: "quote_open",
      contactKey: "gazdovska",
      documentType: "quote",
      state: "quote_open",
      issueDate: daysAgo(now, 3),
      dueDate: daysFromNow(now, 27),
      reverseCharge: true,
      lines: [line("Nové LED osvetlenie predajne – práce a materiál", 1, 3_200, v)],
    },
    {
      key: "quote_accepted",
      contactKey: "tatranska",
      documentType: "quote",
      state: "quote_accepted",
      issueDate: daysAgo(now, 25),
      dueDate: daysFromNow(now, 5),
      respondedAt: daysAgo(now, 22),
      reverseCharge: true,
      lines: [line("Bleskozvod na hlavnej budove", 1, 2_750, v)],
    },
    {
      key: "quote_rejected",
      contactKey: "balaz",
      documentType: "quote",
      state: "quote_rejected",
      issueDate: daysAgo(now, 41),
      dueDate: daysAgo(now, 11),
      respondedAt: daysAgo(now, 36),
      lines: [line("Inteligentná domácnosť – riadenie kúrenia a osvetlenia", 1, 3_900, v)],
    },
    {
      key: "quote_expired",
      contactKey: "kovac",
      documentType: "quote",
      state: "quote_expired",
      issueDate: daysAgo(now, 50),
      dueDate: daysAgo(now, 20),
      lines: [line("Fotovoltická elektráreň 5 kWp na rodinný dom", 1, 6_800, v)],
    },
    {
      key: "draft",
      contactKey: "gazdovska",
      state: "draft",
      issueDate: daysAgo(now, 0),
      lines: [line("Pohotovostná oprava – výpadok chladiaceho boxu", 3, 38, v, "hod"), line("Nočný výjazd", 1, 40, v)],
    },
    {
      key: "ai",
      contactKey: "kovac",
      state: "ai_draft",
      issueDate: daysAgo(now, 0),
      ai: {
        transcript: "Faktúra pre Mareka Kováča, výmena troch zásuviek a vypínača, spolu stoštyridsať eur.",
        confidence: "0.760",
      },
      lines: [line("Výmena zásuviek a vypínača", 1, 140, v)],
    },
  ];
}

const SPECS: Record<DemoKind, (now: Date) => Spec[]> = {
  cz_vat_sro: czVatSro,
  cz_freelancer: (now) => czNonPayer(now, "design"),
  cz_pausal: (now) => czNonPayer(now, "dev"),
  sk_vat_sro: skVatSro,
  sk_freelancer: skFreelancer,
  sk_vat_freelancer: skVatFreelancer,
};

export function buildInvoices(kind: DemoKind, now: Date): DemoInvoice[] {
  return SPECS[kind](now).map((s) => finish(kind, s));
}
