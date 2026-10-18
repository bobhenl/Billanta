/**
 * The demo companies a visitor can pick on /demo. Everything here is made
 * up. IČOs are mod-11 valid but were checked as unused: 27639142, 29184070,
 * 26047292 not found in ARES; 59172649 (2026-10-18), 58264159 and 58392700
 * (2026-10-19) found neither in the Slovak RPO nor in ARES. The bank
 * accounts pass the checksum but could belong to a real person, so a demo
 * never prints a payment QR code. Slovakia has no flat-tax regime like the
 * Czech paušální daň, so its kinds are a company and two živnostníci.
 */
export const DEMO_KINDS = ["cz_vat_sro", "cz_freelancer", "cz_pausal", "sk_vat_sro", "sk_freelancer", "sk_vat_freelancer"] as const;
export type DemoKind = (typeof DEMO_KINDS)[number];

/** The site language a demo is started from; `en` translates the data. */
export type DemoLanguage = "cs" | "sk" | "en";

export function isDemoLanguage(value: unknown): value is DemoLanguage {
  return value === "cs" || value === "sk" || value === "en";
}

export function isDemoKind(value: unknown): value is DemoKind {
  return typeof value === "string" && (DEMO_KINDS as readonly string[]).includes(value);
}

/** The `p_tenant` jsonb of create_demo_tenant (migration 0068). */
export interface DemoTenantFields {
  owner_name: string;
  company_name: string;
  legal_name: string;
  ico: string;
  dic: string | null;
  vat_status: "payer" | "non_payer";
  flat_tax_regime: boolean;
  activity_kind: "main" | "secondary" | null;
  address_street: string;
  address_city: string;
  address_postal_code: string;
  address_country: "CZ" | "SK";
  default_locale: "cs" | "sk" | "en";
  email: string;
  phone: string | null;
  website: string | null;
  registry_note: string;
  bank_account_number: string;
  bank_account_bank_code: string;
  bank_account_iban: string;
  bank_account_swift: string;
}

/** One `p_bank` item of create_demo_tenant. */
export interface DemoBankAccount {
  label: string;
  account_number: string;
  bank_code: string;
  iban: string;
  swift: string;
  currency: string;
}

export interface DemoSupplier {
  tenant: DemoTenantFields;
  bank: DemoBankAccount[];
  home: "CZK" | "EUR";
  payer: boolean;
  language: "cs" | "sk";
  /** Standard VAT rate for a payer; null = no VAT on documents. */
  vatRate: number | null;
}

const CZ_NOTE = "Smyšlená firma z dema Billanta – není zapsána v žádném rejstříku.";
const CZ_PERSON_NOTE = "Smyšlená osoba z dema Billanta – není zapsána v živnostenském rejstříku.";
// A real one reads "Zapísaná v živnostenskom registri Okresného úradu Nitra, č. ŽR 430-…".
const SK_PERSON_NOTE = "Vymyslená osoba z dema Billanta – nie je zapísaná v živnostenskom registri žiadneho okresného úradu.";

export const SUPPLIERS: Record<DemoKind, DemoSupplier> = {
  cz_vat_sro: {
    tenant: {
      owner_name: "Martin Lipovský",
      company_name: "Lipová stezka",
      legal_name: "Lipová stezka s.r.o.",
      ico: "27639142",
      dic: "CZ27639142",
      vat_status: "payer",
      flat_tax_regime: false,
      activity_kind: null,
      address_street: "Údolní 412/18",
      address_city: "Brno",
      address_postal_code: "602 00",
      address_country: "CZ",
      default_locale: "cs",
      email: "fakturace@lipova-stezka.example",
      phone: null,
      website: "https://lipova-stezka.example",
      registry_note: CZ_NOTE,
      bank_account_number: "2984731007",
      bank_account_bank_code: "2010",
      bank_account_iban: "CZ4420100000002984731007",
      bank_account_swift: "FIOBCZPP",
    },
    bank: [
      { label: "Hlavní účet", account_number: "2984731007", bank_code: "2010", iban: "CZ4420100000002984731007", swift: "FIOBCZPP", currency: "CZK" },
      { label: "Eurový účet", account_number: "2984765004", bank_code: "2010", iban: "CZ3620100000002984765004", swift: "FIOBCZPP", currency: "EUR" },
    ],
    home: "CZK",
    payer: true,
    language: "cs",
    vatRate: 21,
  },
  cz_freelancer: {
    tenant: {
      owner_name: "Tereza Málková",
      company_name: "Tereza Málková",
      legal_name: "Tereza Málková",
      ico: "29184070",
      dic: null,
      vat_status: "non_payer",
      flat_tax_regime: false,
      activity_kind: "main",
      address_street: "Korunní 1207/64",
      address_city: "Praha 10",
      address_postal_code: "101 00",
      address_country: "CZ",
      default_locale: "cs",
      email: "tereza@malkova-design.example",
      phone: null,
      website: "https://malkova-design.example",
      registry_note: CZ_PERSON_NOTE,
      bank_account_number: "1847502000",
      bank_account_bank_code: "3030",
      bank_account_iban: "CZ8430300000001847502000",
      bank_account_swift: "AIRACZPP",
    },
    bank: [
      { label: "Účet", account_number: "1847502000", bank_code: "3030", iban: "CZ8430300000001847502000", swift: "AIRACZPP", currency: "CZK" },
    ],
    home: "CZK",
    payer: false,
    language: "cs",
    vatRate: null,
  },
  cz_pausal: {
    tenant: {
      owner_name: "Ondřej Kalina",
      company_name: "Ondřej Kalina",
      legal_name: "Ondřej Kalina",
      ico: "26047292",
      dic: null,
      vat_status: "non_payer",
      flat_tax_regime: true,
      activity_kind: "main",
      address_street: "Wellnerova 1322/9",
      address_city: "Olomouc",
      address_postal_code: "779 00",
      address_country: "CZ",
      default_locale: "cs",
      email: "ondrej@kalina-dev.example",
      phone: null,
      website: null,
      registry_note: CZ_PERSON_NOTE,
      bank_account_number: "4719302008",
      bank_account_bank_code: "0800",
      bank_account_iban: "CZ0708000000004719302008",
      bank_account_swift: "GIBACZPX",
    },
    bank: [
      { label: "Účet", account_number: "4719302008", bank_code: "0800", iban: "CZ0708000000004719302008", swift: "GIBACZPX", currency: "CZK" },
    ],
    home: "CZK",
    payer: false,
    language: "cs",
    vatRate: null,
  },
  sk_vat_sro: {
    tenant: {
      owner_name: "Lucia Potočná",
      company_name: "Horský potok",
      legal_name: "Horský potok s.r.o.",
      ico: "59172649",
      dic: "SK2023847001",
      vat_status: "payer",
      flat_tax_regime: false,
      activity_kind: null,
      address_street: "Krížna 1146/27",
      address_city: "Bratislava",
      address_postal_code: "811 07",
      address_country: "SK",
      default_locale: "sk",
      email: "fakturacia@horsky-potok.example",
      phone: null,
      website: "https://horsky-potok.example",
      registry_note: "Vymyslená firma z dema Billanta – nie je zapísaná v žiadnom registri.",
      bank_account_number: "2938475006",
      bank_account_bank_code: "1100",
      bank_account_iban: "SK6711000000002938475006",
      bank_account_swift: "TATRSKBX",
    },
    bank: [
      { label: "Hlavný účet", account_number: "2938475006", bank_code: "1100", iban: "SK6711000000002938475006", swift: "TATRSKBX", currency: "EUR" },
      { label: "Rezervný účet", account_number: "2938412005", bank_code: "1100", iban: "SK0511000000002938412005", swift: "TATRSKBX", currency: "EUR" },
    ],
    home: "EUR",
    payer: true,
    language: "sk",
    vatRate: 23,
  },  sk_freelancer: {
    tenant: {
      owner_name: "Katarína Ďurišová",
      company_name: "Katarína Ďurišová",
      legal_name: "Katarína Ďurišová",
      ico: "58264159",
      // A non-payer's DIČ is not required on the invoice; leaving it out keeps it from matching a real person.
      dic: null,
      vat_status: "non_payer",
      flat_tax_regime: false,
      activity_kind: "main",
      address_street: "Štefánikova 1874/36",
      address_city: "Nitra",
      address_postal_code: "949 01",
      address_country: "SK",
      default_locale: "sk",
      email: "katarina@durisova-preklady.example",
      phone: null,
      website: "https://durisova-preklady.example",
      registry_note: SK_PERSON_NOTE,
      bank_account_number: "5182736408",
      bank_account_bank_code: "0900",
      bank_account_iban: "SK1509000000005182736408",
      bank_account_swift: "GIBASKBX",
    },
    bank: [
      { label: "Účet", account_number: "5182736408", bank_code: "0900", iban: "SK1509000000005182736408", swift: "GIBASKBX", currency: "EUR" },
    ],
    home: "EUR",
    payer: false,
    language: "sk",
    vatRate: null,
  },
  sk_vat_freelancer: {
    tenant: {
      owner_name: "Tomáš Hrivnák",
      company_name: "Elektro Hrivnák",
      legal_name: "Tomáš Hrivnák – Elektro Hrivnák",
      ico: "58392700",
      dic: "SK1083947205",
      vat_status: "payer",
      flat_tax_regime: false,
      activity_kind: "main",
      address_street: "Tajovského 2251/14",
      address_city: "Banská Bystrica",
      address_postal_code: "974 01",
      address_country: "SK",
      default_locale: "sk",
      email: "elektro@hrivnak.example",
      phone: null,
      website: null,
      registry_note: SK_PERSON_NOTE,
      bank_account_number: "4729183006",
      bank_account_bank_code: "0200",
      bank_account_iban: "SK7802000000004729183006",
      bank_account_swift: "SUBASKBX",
    },
    bank: [
      { label: "Podnikateľský účet", account_number: "4729183006", bank_code: "0200", iban: "SK7802000000004729183006", swift: "SUBASKBX", currency: "EUR" },
    ],
    home: "EUR",
    payer: true,
    language: "sk",
    vatRate: 23,
  },
};
