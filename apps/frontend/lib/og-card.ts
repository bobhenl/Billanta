import { createTranslator } from 'next-intl';
import cs from '@/messages/cs.json';
import en from '@/messages/en.json';
import sk from '@/messages/sk.json';
import { routing } from '@/i18n/routing';
import { getFeaturePage } from '@/lib/feature-pages';
import { getMunicipalityBySlug } from '@/lib/municipalities';
import { getCalculator, getGuide, getTemplate, GUIDES_HUB_LOCALES, isPublishedIn } from '@/lib/public-tools';
import { PRIVATE_CARD } from '@/lib/site';

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

const SECTIONS: Record<Locale, Record<'features' | 'pricing' | 'legal' | 'about' | 'places' | 'tool' | 'calculators' | 'guides' | 'templates' | 'blog', string>> = {
  cs: { features: 'Funkce', pricing: 'Ceník', legal: 'Právní informace', about: 'O nás', places: 'Fakturace podle obcí', tool: 'Zdarma bez registrace', calculators: 'Kalkulačky', guides: 'Návody', templates: 'Vzory faktur', blog: 'Blog' },
  sk: { features: 'Funkcie', pricing: 'Cenník', legal: 'Právne informácie', about: 'O nás', places: 'Fakturácia podľa obcí', tool: 'Zadarmo bez registrácie', calculators: 'Kalkulačky', guides: 'Návody', templates: 'Vzory faktúr', blog: 'Blog' },
  en: { features: 'Features', pricing: 'Pricing', legal: 'Legal', about: 'About', places: 'Invoicing by municipality', tool: 'Free, no sign-up', calculators: 'Calculators', guides: 'Guides', templates: 'Invoice templates', blog: 'Blog' }
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
      case 'calculators':
        return { title: t('tools.calculators.indexTitle'), subtitle: t('tools.calculators.indexDescription'), section: s.calculators };
      case 'blog':
        return { title: t('blog.title'), subtitle: t('blog.lead'), section: s.blog };
      case 'compare':
        return { title: t('comparePage.title'), subtitle: t('comparePage.lead'), section: t('og.sections.compare') };
      case 'for-accountants':
        return { title: t('accountants.title'), subtitle: t('accountants.lead'), section: t('og.sections.forAccountants') };
      case 'partners':
        return { title: t('partners.title'), subtitle: t('partners.lead'), section: t('og.sections.partners') };
      case 'accountants':
        return { title: t('accountantDirectory.title'), subtitle: t('accountantDirectory.lead'), section: t('og.sections.directory') };
      case PRIVATE_CARD:
        return { title: t('og.privateTitle'), subtitle: t('og.privateSubtitle'), section: t('og.privateSection') };
      case 'guides':
        // The guides hub is published only where some guide is.
        if (!GUIDES_HUB_LOCALES.includes(l)) return null;
        return { title: t('tools.guides.indexTitle'), subtitle: t('tools.guides.indexDescription'), section: s.guides };
      case 'invoice-templates':
        return { title: t('invoiceTemplates.indexTitle'), subtitle: t('invoiceTemplates.indexDescription'), section: s.templates };
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
  // Calculators and guides draw a card only where they are published.
  if (first === 'calculators') {
    const c = getCalculator(second);
    if (!c || !isPublishedIn(c, l)) return null;
    return { title: t('tools.calculators.items.' + c.key + '.name'), subtitle: t('tools.calculators.items.' + c.key + '.description'), section: s.calculators };
  }
  if (first === 'guides') {
    const g = getGuide(second);
    if (!g || !isPublishedIn(g, l)) return null;
    return { title: t('tools.guides.items.' + g.key + '.name'), subtitle: t('tools.guides.items.' + g.key + '.description'), section: s.guides };
  }
  if (first === 'invoice-templates') {
    const x = getTemplate(second);
    if (!x || !isPublishedIn(x, l)) return null;
    return { title: t('invoiceTemplates.items.' + x.key + '.title'), subtitle: t('invoiceTemplates.items.' + x.key + '.description'), section: s.templates };
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
