/**
 * The price list shown on /pricing. Numbers live here, wording lives in
 * the `pricing.plans.*` messages, so a price change is one edit.
 *
 * Prices are per month without VAT, in whole units. `yearly` is the
 * monthly price when the whole year is paid up front (two months free,
 * roughly); `monthly` is the price when paying month by month.
 *
 * Positioned just under the CZ/SK competitors (Fakturoid, iDoklad,
 * SuperFaktúra all sell a ~5 € / ~10 € / ~17-25 € ladder on top of a
 * limited free tier), with the AI features as the reason to pick Plus.
 *
 * Free stops at its included documents; the paid plans meter AI and API
 * instead of switching them off. The limits below are what the backend
 * enforces (PLAN_LIMITS etc. in apps/backend/src/billing/plans.ts, kept
 * equal by a backend spec), so the table cannot promise more than the
 * product does.
 */
export type PlanKey = 'free' | 'start' | 'plus' | 'business';
export type PlanCurrency = 'CZK' | 'EUR';

export type Plan = {
  key: PlanKey;
  price: Record<PlanCurrency, { monthly: number; yearly: number }>;
  popular?: boolean;
};

export const PLANS: Plan[] = [
  { key: 'free', price: { CZK: { monthly: 0, yearly: 0 }, EUR: { monthly: 0, yearly: 0 } } },
  { key: 'start', price: { CZK: { monthly: 149, yearly: 119 }, EUR: { monthly: 5.99, yearly: 4.99 } } },
  {
    key: 'plus',
    price: { CZK: { monthly: 289, yearly: 239 }, EUR: { monthly: 11.99, yearly: 9.99 } },
    popular: true
  },
  { key: 'business', price: { CZK: { monthly: 579, yearly: 479 }, EUR: { monthly: 23.99, yearly: 19.99 } } }
];

/**
 * The prices above are for a card subscription that renews by itself. A
 * period paid by bank transfer (proforma, no auto-renewal) costs this many
 * percent more. Mirrors BANK_TRANSFER_SURCHARGE_PERCENT in
 * apps/backend/src/billing/plans.ts, which a backend spec checks.
 */
export const BANK_TRANSFER_SURCHARGE_PERCENT = 10;

/** A per-month card price with the surcharge, rounded up to a whole koruna or cent, as the backend bills it. */
export function transferPrice(cardPrice: number, currency: PlanCurrency): number {
  const minor = Math.round(cardPrice * 100);
  const step = currency === 'CZK' ? 100 : 1;
  return (Math.ceil((minor * (100 + BANK_TRANSFER_SURCHARGE_PERCENT)) / (100 * step)) * step) / 100;
}

/** Slovak visitors pay in euro; Czech in koruna; English defaults to euro. */
export const defaultCurrency = (locale: string): PlanCurrency => (locale === 'cs' ? 'CZK' : 'EUR');

/**
 * Monthly allowances per plan (null = no limit). Mirrors PLAN_LIMITS in
 * apps/backend/src/billing/plans.ts; a backend spec fails when they differ.
 */
export const PLAN_LIMITS = {
  documents: { free: 10, start: null, plus: null, business: null },
  ai_credits: { free: 5, start: 30, plus: 150, business: 500 },
  api_requests: { free: 0, start: 1000, plus: 10000, business: 50000 }
} as const satisfies Record<string, Record<PlanKey, number | null>>;

/** People the net income report splits income between. Mirrors PLAN_PARTNERS in the backend. */
export const PLAN_PARTNERS = {
  free: 1,
  start: 2,
  plus: 3,
  business: 10
} as const satisfies Record<PlanKey, number>;

/** The cheapest plan of each gated feature. Mirrors FEATURE_MIN_PLAN in the backend. */
export const FEATURE_MIN_PLAN = {
  bank_sync: 'start',
  paypal_sync: 'start',
  stripe_sync: 'start',
  api_keys: 'start',
  card_payments: 'plus',
  accounting_export: 'start',
  income_tax_export: 'start',
  vat_filings: 'plus',
  client_portal: 'start',
  auto_reminders: 'start',
  webhooks: 'start',
  confidential_mode: 'plus'
} as const satisfies Record<string, Exclude<PlanKey, 'free'>>;
export type PlanFeature = keyof typeof FEATURE_MIN_PLAN;

/** What a lower plan still gets of a feature. Mirrors FEATURE_TASTE in the backend. */
export const FEATURE_TASTE: Partial<Record<PlanFeature, { uses: number; per: 'month' | 'ever' }>> = {
  accounting_export: { uses: 1, per: 'month' },
  vat_filings: { uses: 1, per: 'ever' }
};

/** Accountants a company may invite on top of its users, on every plan. */
export const ACCOUNTANT_SEATS = 2;

const perPlan = <T,>(pick: (plan: PlanKey) => T): [T, T, T, T] => [pick('free'), pick('start'), pick('plus'), pick('business')];

/** "119 Kč", "4,99 €", "€0.20": whole amounts without decimals, the rest with two. */
export function formatPlanPrice(value: number, currency: PlanCurrency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

/** The cheapest paid plan's yearly-billed monthly price, for "paid plans start at …" copy. */
export function startingPrice(currency: PlanCurrency): number {
  return Math.min(...PLANS.filter((p) => p.price[currency].yearly > 0).map((p) => p.price[currency].yearly));
}

/**
 * The comparison table under the cards: per row the value for free, start,
 * plus, business. `true`/`false` render as a tick or a dash, a string is a
 * `pricing.compare.cell.*` key, a number is printed as is.
 */
export type CompareCell = boolean | number | string;
export const COMPARISON: { group: string; rows: [row: string, cells: [CompareCell, CompareCell, CompareCell, CompareCell]][] }[] = [
  {
    group: 'invoicing',
    rows: [
      ['docs', ['docsFree', 'unlimited', 'unlimited', 'unlimited']],
      ['types', [true, true, true, true]],
      ['isdoc', [true, true, true, true]],
      ['currencies', [true, true, true, true]],
      ['languages', [true, true, true, true]],
      ['recurring', ['twoTemplates', true, true, true]],
      ['reminders', ['manual', 'automatic', 'automatic', 'automatic']],
      ['invoiceLock', [true, true, true, true]],
      ['brandFooter', [false, true, true, true]]
    ]
  },
  {
    group: 'payments',
    rows: [
      ['bank', [false, true, true, true]],
      ['paypal', [false, true, true, true]],
      ['stripe', [false, true, true, true]],
      ['portal', [false, true, true, true]],
      ['cards', [false, false, true, true]]
    ]
  },
  {
    group: 'ai',
    rows: [
      ['aiCredits', perPlan((p) => PLAN_LIMITS.ai_credits[p])],
      ['voice', [true, true, true, true]],
      ['receipts', [true, true, true, true]],
      ['ownKey', [true, true, true, true]]
    ]
  },
  {
    group: 'tax',
    rows: [
      ['vatLimit', [true, true, true, true]],
      ['annual', ['onScreen', true, true, true]],
      ['vatFilings', ['oneDownload', 'oneDownload', true, true]],
      ['vatFilingsSk', ['oneDownload', 'oneDownload', true, true]],
      ['netIncome', perPlan((p) => PLAN_PARTNERS[p])],
      ['accountantExport', ['csvTaste', 'csvPlus', 'csvPlus', 'csvPlus']]
    ]
  },
  {
    group: 'team',
    rows: [
      ['users', ['oneAccountant', 'oneAccountant', 'threeAccountant', 'tenAccountant']],
      ['companies', ['ownPlan', 'ownPlan', 'ownPlan', 'ownPlan']],
      ['api', perPlan((p) => PLAN_LIMITS.api_requests[p] || false)],
      ['webhooks', [false, true, true, true]],
      ['time', [true, true, true, true]],
      ['backups', [true, true, true, true]],
      ['support', ['email', 'email', 'priority', 'priority']]
    ]
  }
];
