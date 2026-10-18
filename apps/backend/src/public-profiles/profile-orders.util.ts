import { randomInt } from "node:crypto";
import { czechAccountToIban, VAT_RATES, type VatStatus } from "@faktur/cz-compliance";
import { z } from "zod";
import { buyerDetailsSchema, type BuyerDetails } from "../invoices/buyer-details.util";
import { computeInvoiceTotal } from "../invoices/invoice-total.util";
import { SERVICE_ID_PATTERN, type PublicProfile } from "../tenants/public-profile";

/**
 * "Objednat" on the public profile: the rules behind a visitor's order, kept
 * free of Nest and the database so each one can be unit-tested. An order
 * only ever becomes a draft for the owner to review (never issued, never
 * e-mailed to the customer).
 */

export const MAX_ORDER_QUANTITY = 10_000;
export const MAX_CUSTOM_ITEMS = 5;
export const MAX_ORDER_NOTE = 1000;
/** Orders one company accepts per day (Europe/Prague) before the endpoint answers 429. */
export const DEFAULT_DAILY_ORDER_CAP = 30;

const quantity = z
  .number()
  .positive()
  .max(MAX_ORDER_QUANTITY)
  .refine((n) => Math.round(n * 1000) === n * 1000, "quantity_precision");

/** What the public form posts. Strict: unknown keys are rejected, every text is capped. */
export const profileOrderSchema = z
  .object({
    serviceId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SERVICE_ID_PATTERN)
      .nullish()
      .transform((v) => v || null),
    quantity: quantity.default(1),
    customItems: z
      .array(z.object({ description: z.string().trim().min(2).max(200), quantity }).strict())
      .max(MAX_CUSTOM_ITEMS)
      .default([]),
    // Same billing-details rules as the buyer-details link, but the e-mail is required:
    // the owner has no other way to reach whoever ordered.
    buyer: buyerDetailsSchema.superRefine((b, ctx) => {
      if (!b.email) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "email_required" });
    }),
    note: z
      .string()
      .trim()
      .max(MAX_ORDER_NOTE)
      .nullish()
      .transform((v) => v || null),
    // Honeypot: a hidden field people never see. Anything in it = a bot.
    website: z.string().max(500).optional(),
  })
  .strict();

export type ProfileOrder = z.output<typeof profileOrderSchema>;

export type ParsedOrder =
  | { kind: "order"; order: ProfileOrder & { buyer: BuyerDetails & { email: string } } }
  | { kind: "bot" }
  | { kind: "invalid"; issues: { path: string; message: string }[] };

/** Validates the body; a filled honeypot is reported as `bot` so the caller can pretend success. */
export function parseProfileOrder(body: unknown): ParsedOrder {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof raw.website === "string" && raw.website.trim()) return { kind: "bot" };
  const parsed = profileOrderSchema.safeParse(body);
  if (!parsed.success) return { kind: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  return { kind: "order", order: parsed.data as ProfileOrder & { buyer: BuyerDetails & { email: string } } };
}

/** Why the company does not take this order right now, or null when it does. */
export function orderBlock(input: { profile: Pick<PublicProfile, "enabled" | "orders">; todayCount: number; dailyCap: number }): "disabled" | "daily_cap" | null {
  if (!input.profile.enabled || !input.profile.orders.enabled) return "disabled";
  if (input.todayCount >= input.dailyCap) return "daily_cap";
  return null;
}

export interface OrderLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  vatRate: number | null;
}

/**
 * The draft's lines: the chosen service at its listed price, then the
 * visitor's own lines at 0 for the owner to price. Errors are stable codes
 * for a 400. A service without a numeric price also goes in at 0 and the
 * draft is flagged, so nothing is ever guessed.
 */
export function orderLines(
  order: Pick<ProfileOrder, "serviceId" | "quantity" | "customItems">,
  profile: Pick<PublicProfile, "services" | "orders">,
  vatRate: number | null,
): { lines: OrderLine[]; needsAttention: boolean; serviceTitle: string | null } | { error: "unknown_service" | "custom_items_disabled" | "empty_order" } {
  const lines: OrderLine[] = [];
  let needsAttention = false;
  let serviceTitle: string | null = null;
  if (order.serviceId) {
    const service = profile.services.find((s) => s.id === order.serviceId);
    if (!service) return { error: "unknown_service" };
    serviceTitle = service.title;
    if (service.unitPrice == null) needsAttention = true;
    lines.push({ description: service.title, quantity: order.quantity, unit: service.unit, unitPrice: service.unitPrice ?? 0, vatRate });
  }
  if (order.customItems.length > 0) {
    if (!profile.orders.customItems) return { error: "custom_items_disabled" };
    needsAttention = true;
    for (const item of order.customItems) {
      lines.push({ description: item.description.replace(/\s+/g, " "), quantity: item.quantity, unit: null, unitPrice: 0, vatRate });
    }
  }
  if (lines.length === 0) return { error: "empty_order" };
  return { lines, needsAttention, serviceTitle };
}

/** The rate a draft line starts with: the standard rate for a VAT payer, none otherwise. The owner can change it before issuing. */
export function defaultVatRate(vatStatus: VatStatus, country: string): number | null {
  if (vatStatus !== "payer") return null;
  return (country === "SK" ? VAT_RATES.SK : VAT_RATES.CZ).rates[0] ?? null;
}

/** SK companies invoice in euros by default, everyone else in crowns. */
export function orderCurrency(country: string): "CZK" | "EUR" {
  return country === "SK" ? "EUR" : "CZK";
}

/** The draft's internal note (never printed): where it came from and what the customer wrote. */
export function orderInternalNote(input: { email: string | null; note: string | null; customItems: number; contactMatched: boolean; prepaySymbol?: string | null }): string {
  const parts = ["Objednávka z veřejného profilu."];
  if (input.email) parts.push(`E-mail zákazníka: ${input.email}.`);
  if (input.contactMatched) parts.push("Zákazník byl přiřazen k uloženému kontaktu podle IČO/DIČ, kontakt jsme neměnili.");
  if (input.customItems > 0) parts.push("Vlastní položky zákazníka mají cenu 0, doplňte ji.");
  if (input.prepaySymbol) parts.push(`Zákazník dostal platební údaje k platbě předem s VS ${input.prepaySymbol}. Fakturu vystavte, až platbu ověříte.`);
  if (input.note) parts.push(`Poznámka zákazníka: ${input.note}`);
  return parts.join("\n");
}

/** Start of "today" in Prague, for the per-company daily cap. */
export function pragueDayStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const sinceMidnightMs = ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - sinceMidnightMs);
}

export interface OrderPayment {
  amount: number;
  currency: string;
  variableSymbol: string;
  iban: string | null;
  /** Domestic "number/bank code", for people who type the payment in by hand. */
  accountNumber: string | null;
  bic: string | null;
  recipient: string;
}

/**
 * "Platba předem": the payment details the customer sees after ordering, or
 * null when there is nothing safe to ask for. Only an order whose every line
 * has a listed price qualifies (custom items and unpriced services are
 * priced by the owner later), and only when the company has an account.
 */
export function orderPayment(input: {
  prepay: boolean;
  lines: OrderLine[];
  needsPricing: boolean;
  currency: string;
  variableSymbol: string;
  tenant: { companyName: string; bankAccountIban: string | null; bankAccountNumber: string | null; bankAccountBankCode: string | null; bankAccountSwift: string | null };
}): OrderPayment | null {
  if (!input.prepay || input.needsPricing) return null;
  const amount = computeInvoiceTotal(
    input.lines.map((l) => ({ quantity: String(l.quantity), unitPrice: l.unitPrice.toFixed(2), vatRate: l.vatRate != null ? String(l.vatRate) : null })),
  );
  if (!(amount > 0)) return null;
  const t = input.tenant;
  const accountNumber = t.bankAccountNumber
    ? t.bankAccountBankCode && !t.bankAccountNumber.includes("/")
      ? `${t.bankAccountNumber}/${t.bankAccountBankCode}`
      : t.bankAccountNumber
    : null;
  const iban = t.bankAccountIban?.replace(/\s+/g, "") || (t.bankAccountNumber ? czechAccountToIban(t.bankAccountNumber, t.bankAccountBankCode) : null);
  if (!iban && !accountNumber) return null;
  return { amount, currency: input.currency, variableSymbol: input.variableSymbol, iban, accountNumber, bic: t.bankAccountSwift || null, recipient: t.companyName };
}

/**
 * Variable symbol for a prepaid order: 10 digits starting with 9, so it can't
 * clash with the ones derived from invoice numbers (which start with the year).
 * Kept on the draft, and issuing keeps an existing symbol, so bank matching
 * pairs the payment with the invoice later.
 */
export function prepayVariableSymbol(rand: (max: number) => number = randomInt): string {
  return `9${String(rand(1_000_000_000)).padStart(9, "0")}`;
}
