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
 * Free is pay-as-you-go above its included documents (PAYG_PRICE each);
 * the paid plans meter AI and API instead of switching them off.
 *
 * These are not enforced yet: subscription_plans in the backend still
 * has to get matching rows and limits before checkout goes live.
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

/** Slovak visitors pay in euro; Czech in koruna; English defaults to euro. */
export const defaultCurrency = (locale: string): PlanCurrency => (locale === 'cs' ? 'CZK' : 'EUR');

/** Free plan: price of each document beyond the 10 included per month. */
export const PAYG_PRICE: Record<PlanCurrency, number> = { CZK: 5, EUR: 0.2 };

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
      ['reminders', ['manual', 'automatic', 'automatic', 'automatic']]
    ]
  },
  {
    group: 'payments',
    rows: [
      ['bank', [false, true, true, true]],
      ['paypal', [false, true, true, true]],
      ['portal', [false, true, true, true]],
      ['cards', [false, false, true, true]]
    ]
  },
  {
    group: 'ai',
    rows: [
      ['aiCredits', [5, 30, 150, 500]],
      ['voice', [true, true, true, true]],
      ['receipts', [true, true, true, true]],
      ['ownKey', [true, true, true, true]]
    ]
  },
  {
    group: 'tax',
    rows: [
      ['vatLimit', [true, true, true, true]],
      ['annual', [false, true, true, true]],
      ['vatFilings', [false, false, true, true]],
      ['accountantExport', ['csv', 'csvPlus', 'csvPlus', 'csvPlus']]
    ]
  },
  {
    group: 'team',
    rows: [
      ['users', ['oneUser', 'userAccountant', 'threeAccountant', 'tenUsers']],
      ['companies', [1, 1, 1, 'upTo10']],
      ['api', [false, 1000, 10000, 50000]],
      ['time', [true, true, true, true]],
      ['backups', [true, true, true, true]],
      ['support', ['email', 'email', 'priority', 'priority']]
    ]
  }
];
