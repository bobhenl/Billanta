import { generateSpaydString } from "@faktur/cz-compliance";
import { PLAN_PRICES_MINOR, type PaidPlan } from "./plans";

/**
 * Billanta's own billing entity, the payee on proformas for plans paid by
 * bank transfer. From env (PLATFORM_BILLING_*); `null` until name, IČO and
 * IBAN are all set, which keeps "Pay by transfer" hidden.
 */
export interface PlatformBillingEntity {
  name: string;
  ico: string;
  dic: string | null;
  address: string | null;
  email: string | null;
  iban: string;
  bic: string | null;
  /** Domestic form for people who type it in, e.g. "2900000000/2010". */
  account: string | null;
  /** VAT percent added on top of the plan price; 0 for a non-VAT payer. */
  vatRate: number;
  dueDays: number;
}

const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

export function platformBillingEntity(env: Record<string, string | undefined> = process.env): PlatformBillingEntity | null {
  const clean = (v: string | undefined) => (v?.trim() ? v.trim() : null);
  const name = clean(env.PLATFORM_BILLING_NAME);
  const ico = clean(env.PLATFORM_BILLING_ICO);
  const iban = clean(env.PLATFORM_BILLING_IBAN)?.replace(/\s+/g, "").toUpperCase() ?? null;
  if (!name || !ico || !iban || !IBAN_RE.test(iban)) return null;
  const vat = Number(env.PLATFORM_BILLING_VAT_RATE ?? 0);
  const due = Number(env.PLATFORM_BILLING_DUE_DAYS ?? 14);
  return {
    name,
    ico,
    dic: clean(env.PLATFORM_BILLING_DIC),
    address: clean(env.PLATFORM_BILLING_ADDRESS),
    email: clean(env.PLATFORM_BILLING_EMAIL),
    iban,
    bic: clean(env.PLATFORM_BILLING_BIC),
    account: clean(env.PLATFORM_BILLING_ACCOUNT),
    vatRate: Number.isInteger(vat) && vat >= 0 && vat <= 30 ? vat : 0,
    dueDays: Number.isInteger(due) && due >= 1 && due <= 60 ? due : 14,
  };
}

/** A year of `plan` at the yearly rate, in haléře, plus VAT rounded to whole haléře. */
export function proformaAmounts(plan: PaidPlan, vatRate: number): { amountMinor: number; totalMinor: number } {
  const amountMinor = PLAN_PRICES_MINOR[plan].CZK.yearly * 12;
  return { amountMinor, totalMinor: amountMinor + Math.round((amountMinor * vatRate) / 100) };
}

/**
 * Number and variable symbol from the global sequence: `2026000042` fits the
 * 10-digit VS limit and stays unique across years, the number is the same
 * digits with a `PF` prefix so a payment and its proforma read alike.
 */
export function proformaIdentifiers(year: number, seq: number): { number: string; variableSymbol: string } {
  const digits = `${year}${String(seq % 1_000_000).padStart(6, "0")}`;
  return { number: `PF${digits}`, variableSymbol: digits };
}

export function proformaSpayd(
  entity: Pick<PlatformBillingEntity, "iban" | "bic" | "name">,
  p: { totalMinor: number; variableSymbol: string; number: string; dueDate: string },
): string {
  return generateSpaydString({
    iban: entity.iban,
    ...(entity.bic ? { bic: entity.bic } : {}),
    amount: p.totalMinor / 100,
    currency: "CZK",
    variableSymbol: p.variableSymbol,
    message: `${entity.name} ${p.number}`.slice(0, 60),
    dueDate: new Date(`${p.dueDate}T00:00:00Z`),
  });
}
