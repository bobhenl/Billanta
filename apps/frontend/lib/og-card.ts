import { createTranslator } from 'next-intl';
import cs from '@/messages/cs.json';
import en from '@/messages/en.json';
import sk from '@/messages/sk.json';
import { routing } from '@/i18n/routing';
import { getFeaturePage } from '@/lib/feature-pages';
import { getMunicipalityBySlug } from '@/lib/municipalities';

/**
 * What the Open Graph card of one public page says (`/og/<locale>/<path>`).
 * The text is looked up from the path, never taken from the URL, so the
 * endpoint cannot be used to draw arbitrary text under the brand. Unknown
 * paths return null (404).
 */
export interface OgCard {
  title: string;
  subtitle?: string;
  section?: string;
}

const MESSAGES = { cs, sk, en } as const;
type Locale = keyof typeof MESSAGES;

const SECTIONS: Record<Locale, Record<'features' | 'pricing' | 'legal' | 'about' | 'places' | 'tool', string>> = {
  cs: { features: 'Funkce', pricing: 'Ceník', legal: 'Právní informace', about: 'O nás', places: 'Fakturace podle obcí', tool: 'Zdarma bez registrace' },
  sk: { features: 'Funkcie', pricing: 'Cenník', legal: 'Právne informácie', about: 'O nás', places: 'Fakturácia podľa obcí', tool: 'Zadarmo bez registrácie' },
  en: { features: 'Features', pricing: 'Pricing', legal: 'Legal', about: 'About', places: 'Invoicing by municipality', tool: 'Free, no sign-up' }
};

const LEGAL: Record<string, string> = { terms: 'legal.terms', privacy: 'legal.privacy', dpa: 'legal.dpa', cookies: 'cookies.page' };

export function resolveOgCard(locale: string, path: string[]): OgCard | null {
  if (!(routing.locales as readonly string[]).includes(locale)) return null;
  const l = locale as Locale;
  const t = createTranslator({ locale: l, messages: MESSAGES[l] }) as unknown as (key: string, values?: Record<string, string>) => string;
  const s = SECTIONS[l];
  const [first, second, ...rest] = path;
  if (rest.length) return null;

  if (!first) return { title: t('marketing.hero.title'), subtitle: t('marketing.hero.subtitle') };
  if (second === undefined) {
    switch (first) {
      case 'about':
        return { title: t('about.title'), subtitle: t('about.lead'), section: s.about };
      case 'pricing':
        return { title: t('pricing.title'), subtitle: t('pricing.metaDescription'), section: s.pricing };
      case 'features':
        return { title: t('featurePages.indexTitle'), subtitle: t('featurePages.indexDescription'), section: s.features };
      case 'create-invoice':
        return { title: t('guestInvoice.seoTitle'), subtitle: t('guestInvoice.seoDescription'), section: s.tool };
      case 'invoicing':
        return { title: t('municipalityPages.indexTitle'), subtitle: t('municipalityPages.indexLead'), section: s.places };
    }
    return null;
  }
  if (first === 'features') {
    const feature = getFeaturePage(second);
    if (!feature) return null;
    return {
      title: t(`featurePages.items.${feature.key}.title`),
      subtitle: t(`featurePages.items.${feature.key}.description`),
      section: s.features
    };
  }
  if (first === 'legal' && LEGAL[second]) {
    return { title: t(`${LEGAL[second]}.title`), section: s.legal };
  }
  if (first === 'invoicing') {
    const m = getMunicipalityBySlug(second);
    if (!m) return null;
    return { title: t('municipalityPages.heading', { name: m.name }), subtitle: `${m.district} · ${m.region}`, section: s.places };
  }
  return null;
}
