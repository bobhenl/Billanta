import { addDays, daysAgo } from "./dates";
import { SUPPLIERS, type DemoKind } from "./kinds";

/**
 * Received invoices and receipts. Supplier names are invented and carry no
 * IČO, so nothing points at a real company. `amount` is gross like the rest
 * of the app, except for a reverse-charge expense, where it is the net.
 */
export interface DemoExpense {
  supplierName: string;
  description: string;
  amount: number;
  vatRate: number;
  currency: string;
  exchangeRate: number | null;
  expenseDate: Date;
  category: "material" | "services" | "software" | "travel" | "fuel" | "office" | "telecom" | "rent" | "marketing" | "other";
  documentNumber: string | null;
  dueDate: Date | null;
  /** null = still unpaid. */
  paidAt: Date | null;
  reverseCharge: boolean;
  reverseChargeCode: string | null;
  note: string | null;
}

type Row = [
  supplierName: string,
  description: string,
  amount: number,
  vatRate: number,
  daysBack: number,
  category: DemoExpense["category"],
  /** Days after the expense date it was paid; null = unpaid. */
  paidAfter: number | null,
];

function rows(kind: DemoKind, now: Date, list: Row[]): DemoExpense[] {
  const home = SUPPLIERS[kind].home;
  return list.map(([supplierName, description, amount, vatRate, back, category, paidAfter], i) => {
    const expenseDate = daysAgo(now, back);
    return {
      supplierName,
      description,
      amount,
      vatRate,
      currency: home,
      exchangeRate: null,
      expenseDate,
      category,
      documentNumber: `${2026}${String(1040 + i * 7).padStart(5, "0")}`,
      dueDate: addDays(expenseDate, 14),
      paidAt: paidAfter === null ? null : addDays(expenseDate, paidAfter),
      reverseCharge: false,
      reverseChargeCode: null,
      note: null,
    };
  });
}

function czVatSro(now: Date): DemoExpense[] {
  const list = rows("cz_vat_sro", now, [
    ["Dřevosklad Habrovany s.r.o.", "Dubové fošny 40 mm, 2,4 m³", 96_800, 21, 82, "material", 10],
    ["Dřevosklad Habrovany s.r.o.", "Ořechová dýha a lepidlo", 18_150, 21, 40, "material", 9],
    ["Kování Pernštejn s.r.o.", "Panty, výsuvy a úchytky", 12_342, 21, 33, "material", 12],
    ["Lak a olej Morava s.r.o.", "Tvrdý voskový olej 25 l", 9_680, 21, 21, "material", 7],
    ["Hala Údolní – pronájem", "Nájem dílny – září", 24_200, 21, 47, "rent", 3],
    ["Hala Údolní – pronájem", "Nájem dílny – říjen", 24_200, 21, 17, "rent", 3],
    ["Čerpací stanice U Mostu", "Nafta – dodávka", 2_890, 21, 26, "fuel", 0],
    ["Čerpací stanice U Mostu", "Nafta – dodávka", 3_120, 21, 9, "fuel", 0],
    ["Telekom Jih a.s.", "Mobilní tarify – 3 čísla", 1_452, 21, 20, "telecom", 6],
    ["Pila Vranov s.r.o.", "Formátování desek na zakázku", 7_260, 21, 6, "services", null],
  ]);
  return [
    ...list,
    {
      // Domestic reverse charge (§92a): a subcontractor's installation work,
      // so `amount` is the net and the company self-assesses the VAT.
      supplierName: "Montáže Kraus s.r.o.",
      description: "Subdodávka – montáž obkladů, Hotel Javorový dvůr",
      amount: 38_000,
      vatRate: 21,
      currency: "CZK",
      exchangeRate: null,
      expenseDate: daysAgo(now, 30),
      category: "services",
      documentNumber: "FV-2026-0412",
      dueDate: daysAgo(now, 16),
      paidAt: daysAgo(now, 18),
      reverseCharge: true,
      reverseChargeCode: "4",
      note: null,
    },
    {
      supplierName: "Planfuchs Software GmbH",
      description: "Licence CAD programu – roční",
      amount: 690,
      vatRate: 21,
      currency: "EUR",
      exchangeRate: 24.33,
      expenseDate: daysAgo(now, 52),
      category: "software",
      documentNumber: "PW-88412",
      dueDate: daysAgo(now, 52),
      paidAt: daysAgo(now, 52),
      reverseCharge: false,
      reverseChargeCode: null,
      note: "Placeno kartou.",
    },
  ];
}

function czFreelancer(now: Date): DemoExpense[] {
  return [
    ...rows("cz_freelancer", now, [
      ["Papírnictví Vinohrady", "Skicáky a fixy", 1_284, 21, 64, "office", 0],
      ["Coworking Korunní", "Místo v coworkingu – září", 4_840, 21, 46, "rent", 2],
      ["Coworking Korunní", "Místo v coworkingu – říjen", 4_840, 21, 16, "rent", 2],
      ["Tiskárna Na Rohu s.r.o.", "Tisk portfolia, 5 kusů", 3_025, 21, 29, "marketing", 5],
      ["Telekom Jih a.s.", "Mobilní tarif", 499, 21, 19, "telecom", 4],
      ["Fotolab Žižkov", "Pronájem studia na půl dne", 2_420, 21, 8, "services", null],
    ]),
    {
      supplierName: "Inkfern Labs Inc.",
      description: "Předplatné grafického programu – měsíční",
      amount: 24,
      vatRate: 21,
      currency: "USD",
      exchangeRate: 22.95,
      expenseDate: daysAgo(now, 12),
      category: "software",
      documentNumber: "IF-2026-10-4471",
      dueDate: daysAgo(now, 12),
      paidAt: daysAgo(now, 12),
      reverseCharge: false,
      reverseChargeCode: null,
      note: "Placeno kartou.",
    },
  ];
}

function czPausal(now: Date): DemoExpense[] {
  // A flat-tax payer doesn't deduct costs; these are here so the expense
  // pages are not empty.
  return rows("cz_pausal", now, [
    ["Hosting Morava s.r.o.", "VPS – čtvrtletně", 1_815, 21, 58, "software", 3],
    ["Elektro Haná s.r.o.", "Externí monitor 27\"", 7_490, 21, 37, "office", 0],
    ["Telekom Jih a.s.", "Internet a mobil", 899, 21, 18, "telecom", 4],
    ["Konference Brno z.s.", "Vstupenka na vývojářskou konferenci", 2_900, 21, 9, "travel", null],
  ]);
}

function skVatSro(now: Date): DemoExpense[] {
  return [
    ...rows("sk_vat_sro", now, [
      ["Autobusy Podtatranec s.r.o.", "Preprava 24 osôb Bratislava – Jasná", 760, 23, 74, "travel", 8],
      ["Horský hotel Kosodrevina", "Ubytovanie a strava – teambuilding", 1_420, 23, 73, "services", 12],
      ["Kancelárie Krížna s.r.o.", "Nájom kancelárie – september", 980, 23, 47, "rent", 3],
      ["Kancelárie Krížna s.r.o.", "Nájom kancelárie – október", 980, 23, 17, "rent", 3],
      ["Tlačiareň Dunaj s.r.o.", "Letáky a roll-up", 286, 23, 31, "marketing", 6],
      ["Telekom Západ a.s.", "Mobilné paušály", 64, 23, 20, "telecom", 5],
      ["Čerpacia stanica Pri moste", "Nafta – služobné auto", 92, 23, 11, "fuel", 0],
      ["Požičovňa Hrebeň s.r.o.", "Požičanie výstroja na výstup", 450, 23, 6, "material", null],
    ]),
    {
      supplierName: "Anmeldewerk Salzach GmbH",
      description: "Registračný systém na podujatia – ročná licencia",
      amount: 360,
      vatRate: 23,
      currency: "EUR",
      exchangeRate: null,
      expenseDate: daysAgo(now, 55),
      category: "software",
      documentNumber: "AS-2026-1188",
      dueDate: daysAgo(now, 41),
      paidAt: daysAgo(now, 45),
      // Bought from an Austrian company, so the VAT is self-assessed.
      reverseCharge: true,
      reverseChargeCode: null,
      note: null,
    },
  ];
}

function skFreelancer(now: Date): DemoExpense[] {
  // Domestic sellers only: a non-payer buying a service from abroad would
  // have to register for VAT (§7a ZoDPH).
  return rows("sk_freelancer", now, [
    ["Kníhkupectvo Pod Kalváriou", "Technický slovník nemecko-slovenský", 48, 5, 61, "office", 0],
    ["Coworking Hradná s.r.o.", "Miesto v coworkingu – september", 145, 23, 46, "rent", 2],
    ["Coworking Hradná s.r.o.", "Miesto v coworkingu – október", 145, 23, 16, "rent", 2],
    ["Softvér Váh s.r.o.", "Prekladateľský softvér – ročná licencia", 276, 23, 38, "software", 4],
    ["Telekom Západ a.s.", "Mobilný paušál a internet", 32, 23, 19, "telecom", 5],
    ["Jazyková škola Nitrianska s.r.o.", "Kurz odbornej angličtiny – strojárstvo", 210, 23, 7, "services", null],
  ]);
}

function skVatFreelancer(now: Date): DemoExpense[] {
  return [
    ...rows("sk_vat_freelancer", now, [
      ["Elektro Hron s.r.o.", "Káble CYKY a chráničky", 1_164, 23, 75, "material", 10],
      ["Elektro Hron s.r.o.", "Rozvádzač a ističe", 862, 23, 58, "material", 10],
      ["Elektro Hron s.r.o.", "Svietidlá a zásuvky", 437, 23, 33, "material", 8],
      ["Čerpacia stanica Pri moste", "Nafta – dodávka", 86, 23, 27, "fuel", 0],
      ["Čerpacia stanica Pri moste", "Nafta – dodávka", 79, 23, 9, "fuel", 0],
      ["Náradie Urpín s.r.o.", "Revízny prístroj a sada skrutkovačov", 694, 23, 44, "material", 0],
      ["Telekom Západ a.s.", "Mobilný paušál", 24, 23, 20, "telecom", 5],
      ["Autoservis Radvaň s.r.o.", "Servis dodávky", 318, 23, 5, "services", null],
    ]),
    {
      // Domestic reverse charge (§69 ods. 12 písm. j): a subcontractor's
      // construction work, so `amount` is the net and the VAT is self-assessed.
      supplierName: "Montáže Sitno s.r.o.",
      description: "Subdodávka – drážkovanie a murárske práce, Pekáreň Gazdovská",
      amount: 1_200,
      vatRate: 23,
      currency: "EUR",
      exchangeRate: null,
      expenseDate: daysAgo(now, 66),
      category: "services",
      documentNumber: "FA-2026-0217",
      dueDate: daysAgo(now, 52),
      paidAt: daysAgo(now, 54),
      reverseCharge: true,
      reverseChargeCode: null,
      note: null,
    },
  ];
}

export function buildExpenses(kind: DemoKind, now: Date): DemoExpense[] {
  switch (kind) {
    case "cz_vat_sro":
      return czVatSro(now);
    case "cz_freelancer":
      return czFreelancer(now);
    case "cz_pausal":
      return czPausal(now);
    case "sk_vat_sro":
      return skVatSro(now);
    case "sk_freelancer":
      return skFreelancer(now);
    case "sk_vat_freelancer":
      return skVatFreelancer(now);
  }
}
