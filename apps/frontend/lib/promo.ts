/** Promo code from `?promo=` (events, creators, schools), kept 30 days until the new company redeems it. */
export const PROMO_COOKIE = 'billanta_promo';
/** Mirrors apps/backend/src/promo-codes/promo-logic.ts (stored upper case). */
export const PROMO_CODE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,30}[A-Za-z0-9])$/;

export interface PromoBenefit {
  code: string;
  benefitType: 'trial_days' | 'free_months';
  benefitPlan: 'start' | 'plus' | 'business';
  benefitValue: number;
}
