import type { DemoKind } from './demo';

export interface DemoAudience {
  /** The demo company shown first. */
  kind: DemoKind;
  /** The Slovak counterpart for an sk visitor, for audiences that aren't tied to one country. */
  skKind?: DemoKind;
  /** A key of BUSINESS_PRESETS. */
  preset: string;
  empty: boolean;
}

/**
 * `/demo?for=<audience>` from the partner pages: preselects the picker for
 * the people a partner sends, so "Try it" lands on something that looks like
 * their business. Only a preselection; every choice stays open. The language
 * comes from the link's locale (the expats page links to /en/demo).
 */
export const DEMO_AUDIENCES = {
  // Course participants are founding a business right now: nothing to show yet.
  courses: { kind: 'cz_freelancer', preset: 'tradesman', empty: true },
  coworkings: { kind: 'cz_freelancer', preset: 'flatTax', empty: false },
  communities: { kind: 'cz_pausal', preset: 'flatTax', empty: false },
  expats: { kind: 'cz_freelancer', preset: 'flatTax', empty: false },
  banks: { kind: 'cz_vat_sro', preset: 'withAccountant', empty: false },
  // The segment pages (/for-schools, /for-creators, /events) can link here too.
  schools: { kind: 'cz_freelancer', preset: 'invoicingOnly', empty: true },
  creators: { kind: 'cz_pausal', preset: 'flatTax', empty: false },
  events: { kind: 'cz_freelancer', preset: 'invoicingOnly', empty: false },
  // The pages by experience level (/your-first-invoice, /invoicing-for-*).
  firstInvoice: { kind: 'cz_freelancer', skKind: 'sk_freelancer', preset: 'invoicingOnly', empty: true },
  beginners: { kind: 'cz_pausal', skKind: 'sk_freelancer', preset: 'flatTax', empty: false },
  advanced: { kind: 'cz_vat_sro', skKind: 'sk_vat_sro', preset: 'withAccountant', empty: false }
} as const satisfies Record<string, DemoAudience>;

/** The company an audience starts with in this locale. */
export function audienceKind(audience: DemoAudience, locale: string): DemoKind {
  return locale === 'sk' && audience.skKind ? audience.skKind : audience.kind;
}

export type DemoAudienceKey = keyof typeof DEMO_AUDIENCES;

export function demoAudience(value: unknown): DemoAudienceKey | null {
  return typeof value === 'string' && Object.hasOwn(DEMO_AUDIENCES, value) ? (value as DemoAudienceKey) : null;
}
