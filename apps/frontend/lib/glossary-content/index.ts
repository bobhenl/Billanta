import { CS } from './cs';
import { EN } from './en';
import { SK } from './sk';
import type { GlossaryText, GlossaryTexts } from './types';

export type { GlossaryText } from './types';

const TEXTS: Record<string, GlossaryTexts> = { cs: CS, sk: SK, en: EN };

/** The term's text in `locale`, or undefined where it has none (a Czech-only term in Slovak). */
export function glossaryText(locale: string, slug: string): GlossaryText | undefined {
  return TEXTS[locale]?.[slug];
}

/** All texts of one language, keyed by slug. */
export function glossaryTexts(locale: string): GlossaryTexts {
  return TEXTS[locale] ?? {};
}
