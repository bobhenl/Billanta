import { z } from "zod";
import { EXCHANGE_RATE_SETTINGS, REPORT_RATE_MODES } from "../invoices/exchange-rate-mode";
import { PUBLIC_LINK_PREFIXES } from "../public-links/public-link";

/**
 * Settings → Invoices: which optional fields the invoice form shows
 * expanded for a new document (the rest sit behind "+ field" chips), preset
 * labels for custom header fields, and defaults for "place of issue" and
 * "issued by". Field set modelled on InvoiceOcean / Invoice Ninja.
 * Stored as `tenants.invoice_form_prefs` (jsonb); unknown keys are dropped.
 */
export const OPTIONAL_INVOICE_FIELDS = [
  "itemCode",
  "unit",
  "discount",
  "taxableSupplyDate",
  "symbols",
  "orderNumber",
  "issuePlace",
  "issuedBy",
  "noteAbove",
  "internalNote",
  "customFields",
  "language",
] as const;

const fieldText = z.string().trim().max(100).nullish();

/** At most this many default line items start a blank invoice. */
export const MAX_DEFAULT_ITEMS = 10;

/** A line item a blank invoice starts with (Settings → Faktury → Výchozí hodnoty). */
const defaultItemSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().min(0).max(1_000_000).default(1),
    unit: z.string().trim().max(20).nullish(),
    unit_price: z.number().min(-1_000_000_000).max(1_000_000_000).default(0),
    vat_rate: z.number().min(0).max(100).nullable().default(null),
  })
  .transform((i) => ({
    description: i.description,
    quantity: i.quantity,
    unit: i.unit || null,
    unitPrice: i.unit_price,
    vatRate: i.vat_rate,
  }));

/** The company's own "jednotný kurz" (§ 38 odst. 1 ZDP): CZK per 1 unit of `currency` for a calendar year. */
const annualRateSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((c) => c !== "CZK", "CZK needs no rate"),
  rate: z.number().positive().max(1_000_000),
});

/** Accent colours offered for the PDF (title, total box); the first is the default. */
export const PDF_ACCENTS = ["#4f46e5", "#2563eb", "#0d9488", "#16a34a", "#ea580c", "#e11d48", "#334155", "#111827"] as const;

/** Reminder settings for tenants that never saved them. */
export const REMINDER_DEFAULTS = { enabled: true, intervalDays: 7, max: 3 } as const;

export interface ReminderPrefs {
  enabled: boolean;
  intervalDays: number;
  max: number;
}

/** The tenant's reminder settings, with defaults for missing or out-of-range values. */
export function reminderPrefsOf(prefs: unknown): ReminderPrefs {
  const p = (prefs ?? {}) as { remindersEnabled?: unknown; reminderIntervalDays?: unknown; reminderMax?: unknown };
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  return {
    enabled: typeof p.remindersEnabled === "boolean" ? p.remindersEnabled : REMINDER_DEFAULTS.enabled,
    intervalDays: int(p.reminderIntervalDays, 1, 60, REMINDER_DEFAULTS.intervalDays),
    max: int(p.reminderMax, 1, 10, REMINDER_DEFAULTS.max),
  };
}

/** API shape (snake_case) → stored shape (camelCase, as the frontend reads it). */
export const invoiceFormPrefsSchema = z
  .object({
    show: z.record(z.enum(OPTIONAL_INVOICE_FIELDS), z.boolean()).default({}),
    custom_field_labels: z.array(z.string().trim().min(1).max(40)).max(4).default([]),
    default_issue_place: fieldText,
    default_issued_by: fieldText,
    /** bitfaktura-style "prices incl. VAT": the form starts in gross mode. */
    prices_include_vat: z.boolean().default(false),
    pdf_accent: z.enum(PDF_ACCENTS).default(PDF_ACCENTS[0]),
    /** Bilingual PDF: labels also in this language ("Datum vystavení / Issue date"). */
    pdf_second_language: z.enum(["cs", "sk", "en"]).nullish(),
    /** Automatic overdue reminders (daily sweep): on/off, days between them, how many at most. */
    reminders_enabled: z.boolean().default(true),
    reminder_interval_days: z.number().int().min(1).max(60).default(REMINDER_DEFAULTS.intervalDays),
    reminder_max: z.number().int().min(1).max(10).default(REMINDER_DEFAULTS.max),
    // Defaults for a blank new invoice. The ids are only hints: the form
    // loads them through RLS and ignores ones that no longer exist.
    default_currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
    default_bank_account_id: z.string().uuid().nullish(),
    default_contact_id: z.string().uuid().nullish(),
    default_items: z.array(defaultItemSchema).max(MAX_DEFAULT_ITEMS).default([]),
    default_note_above: z.string().trim().max(2000).nullish(),
    /** Printed on invoices: daily ČNB rate or no conversion (exchange-rate-mode.ts). "annual" is the old setting: daily on invoices, annual in reports. */
    exchange_rate_mode: z.enum([...EXCHANGE_RATE_SETTINGS, "annual"]).default("cnb_daily"),
    /** Used by reports and the income-tax estimate: each document's rate, or the jednotný kurz of the year. */
    report_rate_mode: z.enum(REPORT_RATE_MODES).optional(),
    annual_rates: z
      .array(annualRateSchema)
      .max(100)
      .default([])
      .refine((rates) => new Set(rates.map((r) => `${r.year}:${r.currency}`)).size === rates.length, "One rate per year and currency"),
    /** What goes in front of the key in customer links (public-links/public-link.ts). */
    public_link_prefix: z.enum(PUBLIC_LINK_PREFIXES).default("number"),
    /** The "Vystaveno v Billantě" line; only a paid plan can switch it off (invoices/brand-credit.ts). */
    brand_credit: z.boolean().default(true),
  })
  .transform((p) => ({
    show: p.show as Partial<Record<OptionalInvoiceField, boolean>>,
    customFieldLabels: p.custom_field_labels,
    defaultIssuePlace: p.default_issue_place || null,
    defaultIssuedBy: p.default_issued_by || null,
    pricesIncludeVat: p.prices_include_vat,
    pdfAccent: p.pdf_accent,
    pdfSecondLanguage: p.pdf_second_language ?? null,
    remindersEnabled: p.reminders_enabled,
    reminderIntervalDays: p.reminder_interval_days,
    reminderMax: p.reminder_max,
    defaultCurrency: p.default_currency || null,
    defaultBankAccountId: p.default_bank_account_id || null,
    defaultContactId: p.default_contact_id || null,
    defaultItems: p.default_items,
    defaultNoteAbove: p.default_note_above || null,
    exchangeRateMode: p.exchange_rate_mode === "annual" ? ("cnb_daily" as const) : p.exchange_rate_mode,
    reportRateMode: p.report_rate_mode ?? (p.exchange_rate_mode === "annual" ? ("annual" as const) : ("daily" as const)),
    annualRates: [...p.annual_rates].sort((a, b) => b.year - a.year || a.currency.localeCompare(b.currency)),
    publicLinkPrefix: p.public_link_prefix,
    brandCredit: p.brand_credit,
  }));

/** The tenant's PDF accent, falling back to the default for old or unknown values. */
export function pdfAccentOf(prefs: unknown): string {
  const value = (prefs as { pdfAccent?: unknown } | null)?.pdfAccent;
  return PDF_ACCENTS.find((c) => c === value) ?? PDF_ACCENTS[0];
}

/** The tenant's second PDF language, or null (old or unknown values too). */
export function pdfSecondLanguageOf(prefs: unknown): "cs" | "sk" | "en" | null {
  const value = (prefs as { pdfSecondLanguage?: unknown } | null)?.pdfSecondLanguage;
  return value === "cs" || value === "sk" || value === "en" ? value : null;
}

/** A pale tint of `hex` (mixed with white) for the total box background. */
export function tintOf(hex: string, amount = 0.1): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(255 - (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export type OptionalInvoiceField = (typeof OPTIONAL_INVOICE_FIELDS)[number];
export type InvoiceFormPrefs = z.output<typeof invoiceFormPrefsSchema>;
