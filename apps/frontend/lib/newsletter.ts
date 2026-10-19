/** Mirrors NEWSLETTER_TOPICS and the enums in apps/backend/src/newsletter/newsletter.schemas.ts. */
export const NEWSLETTER_TOPICS = ['tax_rates', 'limits', 'deadlines', 'sk_einvoicing'] as const;
export type NewsletterTopic = (typeof NEWSLETTER_TOPICS)[number];
export type NewsletterCountry = 'CZ' | 'SK';
export type NewsletterSource = 'blog' | 'guides' | 'calculators' | 'sk_einvoicing' | 'settings' | 'other';

/** 43 base64url characters (32 random bytes); anything else never reaches the backend. */
export const NEWSLETTER_CONFIRM_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const isNewsletterTopic = (x: unknown): x is NewsletterTopic =>
  typeof x === 'string' && (NEWSLETTER_TOPICS as readonly string[]).includes(x);
