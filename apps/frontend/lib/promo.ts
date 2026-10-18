/** Promo code from `?promo=` or a `/join/CODE` link (events, creators, schools), kept 30 days until the new company redeems it. */
export const PROMO_COOKIE = 'billanta_promo';
/** Mirrors apps/backend/src/promo-codes/promo-logic.ts (stored upper case). */
export const PROMO_CODE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,30}[A-Za-z0-9])$/;
/** The group join link a QR code or poster points to, with or without a locale. */
export const JOIN_PATH = /^\/(?:(cs|sk|en)\/)?join\/([^/]+)\/?$/;

export interface PromoBenefit {
  code: string;
  benefitType: 'trial_days' | 'free_months';
  benefitPlan: 'start' | 'plus' | 'business';
  benefitValue: number;
}

/** What `GET /v1/public/promo-codes/:code` tells the join page (never the referrer or the counts). */
export interface JoinInfo extends PromoBenefit {
  kind: string;
  ownerLabel: string | null;
  businessPreset: string | null;
  defaultLocale: 'cs' | 'sk' | 'en' | null;
}
