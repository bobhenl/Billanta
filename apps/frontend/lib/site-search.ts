import cs from '@/messages/cs.json';
import en from '@/messages/en.json';
import sk from '@/messages/sk.json';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { CALCULATORS, GUIDES, GUIDES_HUB_LOCALES, isPublishedIn } from '@/lib/public-tools';
import { getAllMunicipalities, isDistrictSeat, municipalityLocale, type Municipality } from '@/lib/municipalities';

type Messages = typeof cs;
const MESSAGES: Record<string, Messages> = { cs, sk: sk as Messages, en: en as Messages };

export type SearchKind = 'page' | 'feature' | 'calculator' | 'guide' | 'faq' | 'city';

export interface SearchHit {
  kind: SearchKind;
  href: string;
  title: string;
  snippet: string;
}

interface Entry extends SearchHit {
  /** Normalised title and body, matched against the query words. */
  titleKey: string;
  bodyKey: string;
}

/** Lower case, no diacritics, so "faktura" finds "Faktura" and "fakturu" finds "fakturu". */
export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function entry(kind: SearchKind, href: string, title: string, snippet: string, extra = ''): Entry {
  return { kind, href, title, snippet, titleKey: normalise(title), bodyKey: normalise(`${snippet} ${extra}`) };
}

type FeatureText = { name: string; title: string; description: string; lead: string; points: string[]; faq: { q: string; a: string }[] };
type FaqText = { q: string; a: string };
type ToolText = { name: string; description: string; lead?: string; keywords?: string };

const INDEX = new Map<string, Entry[]>();

/** Every public page with real copy, built once per locale from the message catalogs. */
function indexFor(locale: string): Entry[] {
  const cached = INDEX.get(locale);
  if (cached) return cached;
  const m = MESSAGES[locale] ?? MESSAGES.cs!;
  const features = m.featurePages.items as unknown as Record<string, FeatureText>;
  const homeFaq = m.marketing.faq.items as unknown as Record<string, FaqText>;
  const entries: Entry[] = [
    entry('page', '/', m.marketing.seo.title, m.marketing.seo.description),
    entry('page', '/create-invoice', m.guestInvoice.seoTitle, m.guestInvoice.seoDescription),
    entry('page', '/pricing', m.pricing.seoTitle, m.pricing.metaDescription, m.pricing.lead),
    entry('page', '/features', m.featurePages.indexHeading, m.featurePages.indexDescription),
    entry('page', '/invoicing', m.municipalityPages.indexTitle, m.municipalityPages.indexLead),
    entry('page', '/about', m.about.title, m.about.lead, `${m.about.whatBody} ${m.about.whoBody}`),
    entry('page', '/legal/terms', m.legal.terms.title, m.legal.terms.intro),
    entry('page', '/legal/privacy', m.legal.privacy.title, m.legal.privacy.intro),
    entry('page', '/legal/dpa', m.legal.dpa.title, m.legal.dpa.intro)
  ];
  for (const f of FEATURE_PAGES) {
    const text = features[f.key];
    if (!text) continue;
    const href = `/features/${f.slug}`;
    entries.push(entry('feature', href, text.name, text.description, `${text.title} ${text.lead} ${text.points.join(' ')}`));
    for (const item of text.faq ?? []) entries.push(entry('faq', href, item.q, item.a));
  }
  for (const item of Object.values(homeFaq)) entries.push(entry('faq', '/#faq', item.q, item.a));

  // Calculators and guides, only in the languages they are published in
  // (lib/public-tools.ts): a Czech-rules page is not offered to Slovak readers.
  const tools = m.tools as unknown as { calculators: { indexTitle: string; indexDescription: string; items: Record<string, ToolText> }; guides: { indexTitle: string; indexDescription: string; items: Record<string, ToolText> } };
  entries.push(entry('page', '/calculators', tools.calculators.indexTitle, tools.calculators.indexDescription));
  for (const c of CALCULATORS) {
    const text = tools.calculators.items[c.key];
    if (!text || !isPublishedIn(c, locale)) continue;
    entries.push(entry('calculator', `/calculators/${c.slug}`, text.name, text.description, `${text.lead ?? ''} ${text.keywords ?? ''}`));
  }
  if (GUIDES_HUB_LOCALES.includes(locale)) entries.push(entry('page', '/guides', tools.guides.indexTitle, tools.guides.indexDescription));
  for (const g of GUIDES) {
    const text = tools.guides.items[g.key];
    if (!text || !isPublishedIn(g, locale)) continue;
    entries.push(entry('guide', `/guides/${g.slug}`, text.name, text.description, `${text.lead ?? ''} ${text.keywords ?? ''}`));
  }
  INDEX.set(locale, entries);
  return entries;
}

/**
 * Site search over the public pages and municipalities. Every query word
 * has to appear (as a prefix of a word) in the title or the text; title
 * hits rank first. Plain in-memory scan: a few hundred entries.
 */
export function searchSite(locale: string, query: string, limit = 30): SearchHit[] {
  const words = normalise(query).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const has = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word}`).test(text);

  const scored: { hit: SearchHit; score: number }[] = [];
  for (const e of indexFor(locale)) {
    let score = 0;
    let all = true;
    for (const w of words) {
      if (has(e.titleKey, w)) score += 3;
      else if (has(e.bodyKey, w)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ hit: { kind: e.kind, href: e.href, title: e.title, snippet: e.snippet }, score: score + (e.kind === 'feature' || e.kind === 'calculator' || e.kind === 'guide' ? 1 : 0) });
  }

  const cities = searchMunicipalities(words.join(' '), 8, locale).map(
    (c): { hit: SearchHit; score: number } => ({
      hit: { kind: 'city', href: `/invoicing/${c.slug}`, title: c.name, snippet: `${c.district}, ${c.region}` },
      score: 2
    })
  );

  return [...scored, ...cities]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.hit);
}

function searchMunicipalities(query: string, limit: number, locale: string): Municipality[] {
  if (query.length < 3) return [];
  const starts: Municipality[] = [];
  for (const m of getAllMunicipalities()) {
    if (normalise(m.nameAscii).startsWith(query)) starts.push(m);
  }
  // The page's own country first, then district towns, then alphabetically.
  const home = (m: Municipality) => Number(municipalityLocale(m) === locale);
  return starts
    .sort((a, b) => home(b) - home(a) || Number(isDistrictSeat(b)) - Number(isDistrictSeat(a)) || a.name.localeCompare(b.name, 'cs'))
    .slice(0, limit);
}
