import type { DemoKind } from "./kinds";

/**
 * Customers of the demo companies. Made up like the suppliers: the IČOs
 * 25719360, 25830473, 61830712 are not in ARES and 47281634 is in neither
 * ARES nor the Slovak RPO (checked 2026-10-18). Foreign VAT IDs are
 * deliberately all nines. E-mails use the reserved .example TLD.
 */
export interface DemoContact {
  key: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  email: string | null;
  contactPerson: string | null;
  addressStreet: string;
  addressCity: string;
  addressPostalCode: string;
  addressCountry: string;
  isVatPayer: boolean | null;
  isPerson: boolean;
  isStarred: boolean;
  color: string | null;
  internalNote: string | null;
}

type ContactKey =
  | "javor"
  | "kavarna"
  | "atelier"
  | "horakova"
  | "novotny"
  | "tatranska"
  | "holzwerk"
  | "nordlicht"
  | "kestrel"
  | "bluewater"
  | "kovac"
  | "balaz"
  | "bergquelle";

const ALL: Record<ContactKey, Omit<DemoContact, "key" | "isStarred" | "internalNote">> = {
  javor: {
    legalName: "Javorový dvůr s.r.o.",
    ico: "25719360",
    dic: "CZ25719360",
    email: "fakturace@javorovy-dvur.example",
    contactPerson: "Pavel Šindelář",
    addressStreet: "Lesní 2214/7",
    addressCity: "Brno",
    addressPostalCode: "636 00",
    addressCountry: "CZ",
    isVatPayer: true,
    isPerson: false,
    color: "indigo",
  },
  kavarna: {
    legalName: "Kavárna U Tří lamp s.r.o.",
    ico: "25830473",
    dic: "CZ25830473",
    email: "provoz@tri-lampy.example",
    contactPerson: "Klára Veselá",
    addressStreet: "Ztracená 318/12",
    addressCity: "Olomouc",
    addressPostalCode: "779 00",
    addressCountry: "CZ",
    isVatPayer: true,
    isPerson: false,
    color: "amber",
  },
  atelier: {
    legalName: "Ateliér Sedmikráska s.r.o.",
    ico: "61830712",
    dic: "CZ61830712",
    email: "studio@sedmikraska.example",
    contactPerson: "Eva Kroupová",
    addressStreet: "Slezská 1764/42",
    addressCity: "Praha 2",
    addressPostalCode: "120 00",
    addressCountry: "CZ",
    isVatPayer: true,
    isPerson: false,
    color: "green",
  },
  horakova: {
    legalName: "Jana Horáková",
    ico: null,
    dic: null,
    email: "jana.horakova@posta.example",
    contactPerson: null,
    addressStreet: "Polní 56",
    addressCity: "Kuřim",
    addressPostalCode: "664 34",
    addressCountry: "CZ",
    isVatPayer: false,
    isPerson: true,
    color: null,
  },
  novotny: {
    legalName: "Petr Novotný",
    ico: null,
    dic: null,
    email: "petr.novotny@posta.example",
    contactPerson: null,
    addressStreet: "Školní 904/3",
    addressCity: "Hradec Králové",
    addressPostalCode: "500 02",
    addressCountry: "CZ",
    isVatPayer: false,
    isPerson: true,
    color: null,
  },
  tatranska: {
    legalName: "Tatranská chata s.r.o.",
    ico: "47281634",
    dic: "SK2021958004",
    email: "uctaren@tatranska-chata.example",
    contactPerson: "Peter Hudec",
    addressStreet: "Levočská 3105/21",
    addressCity: "Poprad",
    addressPostalCode: "058 01",
    addressCountry: "SK",
    isVatPayer: true,
    isPerson: false,
    color: "sky",
  },
  holzwerk: {
    legalName: "Holzwerk Neumann GmbH",
    ico: null,
    dic: "DE999999999",
    email: "buchhaltung@holzwerk-neumann.example",
    contactPerson: "Jonas Neumann",
    addressStreet: "Bautzner Straße 88",
    addressCity: "Dresden",
    addressPostalCode: "01099",
    addressCountry: "DE",
    isVatPayer: true,
    isPerson: false,
    color: null,
  },
  nordlicht: {
    legalName: "Nordlicht Verlag GmbH",
    ico: null,
    dic: "DE999999990",
    email: "rechnungen@nordlicht-verlag.example",
    contactPerson: "Mia Schröder",
    addressStreet: "Große Elbstraße 145",
    addressCity: "Hamburg",
    addressPostalCode: "22767",
    addressCountry: "DE",
    isVatPayer: true,
    isPerson: false,
    color: null,
  },
  kestrel: {
    legalName: "Kestrel Lane Studio Ltd",
    ico: null,
    dic: "GB999999999",
    email: "accounts@kestrel-lane.example",
    contactPerson: "Oliver Hart",
    addressStreet: "14 Wharf Road",
    addressCity: "London",
    addressPostalCode: "N1 7GR",
    addressCountry: "GB",
    isVatPayer: true,
    isPerson: false,
    color: null,
  },
  bluewater: {
    legalName: "Bluewater Pines LLC",
    ico: null,
    dic: null,
    email: "billing@bluewater-pines.example",
    contactPerson: "Hannah Reed",
    addressStreet: "820 SW Alder Street",
    addressCity: "Portland, OR",
    addressPostalCode: "97205",
    addressCountry: "US",
    isVatPayer: null,
    isPerson: false,
    color: null,
  },
  kovac: {
    legalName: "Marek Kováč",
    ico: null,
    dic: null,
    email: "marek.kovac@posta.example",
    contactPerson: null,
    addressStreet: "Hlinkova 2377/15",
    addressCity: "Žilina",
    addressPostalCode: "010 01",
    addressCountry: "SK",
    isVatPayer: false,
    isPerson: true,
    color: null,
  },
  balaz: {
    legalName: "Ján Baláž",
    ico: null,
    dic: null,
    email: "jan.balaz@posta.example",
    contactPerson: null,
    addressStreet: "Moyzesova 412/8",
    addressCity: "Košice",
    addressPostalCode: "040 01",
    addressCountry: "SK",
    isVatPayer: false,
    isPerson: true,
    color: null,
  },
  bergquelle: {
    legalName: "Bergquelle Reisen GmbH",
    ico: null,
    dic: "ATU99999999",
    email: "office@bergquelle-reisen.example",
    contactPerson: "Lena Gruber",
    addressStreet: "Praterstraße 61",
    addressCity: "Wien",
    addressPostalCode: "1020",
    addressCountry: "AT",
    isVatPayer: true,
    isPerson: false,
    color: null,
  },
};

const PICK: Record<DemoKind, ContactKey[]> = {
  cz_vat_sro: ["javor", "kavarna", "atelier", "horakova", "novotny", "tatranska", "holzwerk", "kestrel", "bluewater"],
  cz_freelancer: ["atelier", "kavarna", "javor", "horakova", "novotny", "tatranska", "nordlicht", "bluewater"],
  cz_pausal: ["javor", "atelier", "kavarna", "novotny", "horakova", "kestrel", "nordlicht"],
  sk_vat_sro: ["tatranska", "kovac", "balaz", "javor", "atelier", "bergquelle", "kestrel"],
};

const NOTES: Partial<Record<ContactKey, { cs: string; sk: string }>> = {
  javor: { cs: "Platí spíš pozdě, upomínat po týdnu.", sk: "Platia skôr neskoro, upomienku poslať po týždni." },
  tatranska: { cs: "Stálý klient, objednávky e-mailem.", sk: "Stály klient, objednávky e-mailom." },
};

export function buildContacts(kind: DemoKind): DemoContact[] {
  const lang = kind === "sk_vat_sro" ? "sk" : "cs";
  return PICK[kind].map((key, i) => ({
    key,
    ...ALL[key],
    // The first two are the regulars the visitor sees on top.
    isStarred: i < 2,
    internalNote: NOTES[key]?.[lang] ?? null,
  }));
}
