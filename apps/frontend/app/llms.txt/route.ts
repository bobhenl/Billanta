import { routing } from '@/i18n/routing';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { GLOSSARY } from '@/lib/glossary';
import { glossaryText } from '@/lib/glossary-content';
import { CALCULATORS, GUIDES } from '@/lib/public-tools';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import en from '@/messages/en.json';

const FEATURE_TEXT = en.featurePages.items as Record<string, { name: string; description: string }>;
const CALC_TEXT = en.tools.calculators.items as Record<string, { name: string; description: string }>;
const GUIDE_TEXT = en.tools.guides.items as Record<string, { name: string; description: string }>;

/**
 * llms.txt (https://llmstxt.org): a short plain-text map of the public site
 * for language-model readers. VoxelRank shipped one (audit §6.1) on the
 * grounds that it is cheap and harmless if unused; same reasoning here.
 */
export const dynamic = 'force-static';

export function GET() {
  const l = routing.defaultLocale;
  const body = `# ${SITE_NAME}

> Online invoicing for freelancers and small businesses in the Czech Republic and Slovakia. Invoices export to ISDOC, customer details are looked up in the ARES registry, every invoice carries a QR payment code (QR Platba / SPAYD), drafts are checked for the details Czech and Slovak VAT and commercial law require (plus Peppol BIS 3.0 rules for foreign customers), and a draft can be dictated as a voice message over Telegram or WhatsApp. Available in Czech, Slovak and English.

## Pages

- [Home](${SITE_URL}/${l}): what the product does, how it works, FAQ
- [Pricing](${SITE_URL}/${l}/pricing): plans
- [Invoice without sign-up](${SITE_URL}/${l}/create-invoice): free one-off PDF invoice, nothing stored
- [Features](${SITE_URL}/${l}/features): one page per feature
${FEATURE_PAGES.map((f) => `  - [${FEATURE_TEXT[f.key]!.name}](${SITE_URL}/${l}/features/${f.slug}): ${FEATURE_TEXT[f.key]!.description}`).join('\n')}
- [Calculators](${SITE_URL}/${l}/calculators): free tax, insurance, VAT and exchange-rate calculators, no sign-up
${CALCULATORS.map((c) => `  - [${CALC_TEXT[c.key]!.name}](${SITE_URL}/${l}/calculators/${c.slug}): ${CALC_TEXT[c.key]!.description}`).join('\n')}
- [Guides](${SITE_URL}/${l}/guides): Czech VAT filing guides
${GUIDES.map((g) => `  - [${GUIDE_TEXT[g.key]!.name}](${SITE_URL}/${l}/guides/${g.slug}): ${GUIDE_TEXT[g.key]!.description}`).join('\n')}
- [Glossary](${SITE_URL}/${l}/glossary): Czech and Slovak invoicing and VAT terms, each with a definition, an example and the law
${GLOSSARY.map((term) => `  - [${glossaryText('en', term.slug)!.term}](${SITE_URL}/${term.market === 'sk' ? 'sk' : l}/glossary/${term.slug}): ${glossaryText('en', term.slug)!.definition}`).join('\n')}
- [About](${SITE_URL}/${l}/about): who it is for and why it exists
- [Invoicing by municipality](${SITE_URL}/${l}/invoicing): index of Czech and Slovak municipalities
- [Terms](${SITE_URL}/${l}/legal/terms)
- [Privacy](${SITE_URL}/${l}/legal/privacy)
- [Data processing agreement](${SITE_URL}/${l}/legal/dpa)
- [Cookies](${SITE_URL}/${l}/legal/cookies)

## Languages

${routing.locales.map((loc) => `- ${loc}: ${SITE_URL}/${loc}`).join('\n')}
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
