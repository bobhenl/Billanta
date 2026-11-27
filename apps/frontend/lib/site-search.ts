import type cs from '@/messages/cs.json';
import type { AppLocale } from '@/i18n/locales';
import { loadMessages } from '@/i18n/messages';
import { FEATURE_PAGES } from '@/lib/feature-pages';
import { glossaryTermsFor } from '@/lib/glossary';
import { glossaryText } from '@/lib/glossary-content';
import { CALCULATORS, GUIDES, GUIDES_HUB_LOCALES, isPublishedIn, REMINDERS, TEMPLATES } from '@/lib/public-tools';
import { getAllMunicipalities, isDistrictSeat, municipalityLocale, type Municipality } from '@/lib/municipalities';
import { comparedBrandsFor } from '@/lib/competitors';
import { lessonContent, lessonPublishedIn, SCHOOL_LESSONS } from '@/lib/school-lessons';
import { SITE_NAME } from '@/lib/site';
import { switchBrandsFor } from '@/lib/switch';

type Messages = typeof cs;

export type SearchKind = 'page' | 'feature' | 'calculator' | 'guide' | 'faq' | 'city' | 'glossary';

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

/** Fills the `{name}` placeholders of a raw catalog string (the index reads messages without ICU).
 *  The index lives as long as the process, so a value that moves on by itself (a year) is left out. */
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (all, key: string) => String(vars[key] ?? all));

/** Text of a list of strings or `{ title, body }` / `{ q, a }` items, for the matched body only. */
function flat(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flat).join(' ');
  if (value && typeof value === 'object') return Object.values(value).map(flat).join(' ');
  return '';
}

const INDEX = new Map<string, Promise<Entry[]>>();

/** Every public page with real copy, built once per locale from the message catalogs. */
function indexFor(locale: string): Promise<Entry[]> {
  let index = INDEX.get(locale);
  if (!index) {
    index = buildIndex(locale);
    INDEX.set(locale, index);
  }
  return index;
}

async function buildIndex(locale: string): Promise<Entry[]> {
  // A partly translated locale searches its catalog merged over English, the text its pages show.
  const m = (await loadMessages(locale as AppLocale)) as unknown as Messages;
  const features = m.featurePages.items as unknown as Record<string, FeatureText>;
  const homeFaq = m.marketing.faq.items as unknown as Record<string, FaqText>;
  const entries: Entry[] = [
    entry('page', '/', m.marketing.seo.title, m.marketing.seo.description),
    entry('page', '/create-invoice', m.guestInvoice.seoTitle, m.guestInvoice.seoDescription),
    entry('page', '/pricing', m.pricing.seoTitle, m.pricing.metaDescription, m.pricing.lead),
    entry('page', '/features', m.featurePages.indexHeading, m.featurePages.indexDescription),
    entry('page', '/invoicing', m.municipalityPages.indexTitle, m.municipalityPages.indexLead),
    entry('page', '/about', m.about.title, m.about.lead, `${m.about.whatBody} ${m.about.whoBody}`),
    entry('page', '/contact', m.contact.title, m.contact.lead),
    entry('page', '/legal/terms', m.legal.terms.title, m.legal.terms.intro),
    entry('page', '/legal/privacy', m.legal.privacy.title, m.legal.privacy.intro),
    entry('page', '/legal/dpa', m.legal.dpa.title, m.legal.dpa.intro),
    entry('page', '/legal/cookies', m.cookies.page.seoTitle, m.cookies.page.intro),
    entry('page', '/legal/classroom-privacy', m.legal.classroomPrivacy.title, m.legal.classroomPrivacy.intro),
    entry('page', '/legal/school-contract', m.legal.schoolContract.title, m.legal.schoolContract.intro),
    entry('page', '/demo', m.demo.meta.title, m.demo.meta.description),
    entry('page', '/dictate-invoice', m.guestInvoice.dictatePage.seoTitle, m.guestInvoice.dictatePage.seoDescription, m.guestInvoice.dictatePage.lead),
    entry('page', '/your-first-invoice', m.learnPages.firstInvoice.seoTitle, m.learnPages.firstInvoice.lead),
    entry('page', '/invoicing-for-beginners', m.learnPages.beginners.seoTitle, m.learnPages.beginners.lead),
    entry('page', '/invoicing-for-advanced', m.learnPages.advanced.seoTitle, m.learnPages.advanced.lead),
    entry('page', '/team-roles', m.learnPages.roles.seoTitle, m.learnPages.roles.lead),
    entry('page', '/for-owners', m.learnPages.owners.seoTitle, m.learnPages.owners.lead),
    entry('page', '/for-assistants', m.learnPages.assistants.seoTitle, m.learnPages.assistants.lead),
    entry('page', '/tax-return-basis', fill(m.taxReturn.landing.seoTitle, { year: '' }).replace(/\s+/g, ' '), m.taxReturn.landing.lead),
    entry('page', '/for-accountants', m.accountants.seoTitle, m.accountants.lead),
    entry('page', '/accountants', m.accountantDirectory.seoTitle, m.accountantDirectory.lead),
    entry('page', '/directory', m.businessDirectory.seoTitle, fill(m.businessDirectory.metaDescription, { site: SITE_NAME }), m.businessDirectory.lead),
    entry('page', '/for-schools', m.schools.seoTitle, m.schools.lead),
    entry('page', '/for-schools/lessons', m.schoolLessons.indexMetaTitle, m.schoolLessons.indexMeta),
    entry('page', '/for-creators', m.creators.seoTitle, m.creators.lead),
    entry('page', '/events', m.events.seoTitle, m.events.lead),
    entry('page', '/partners', m.partners.seoTitle, m.partners.lead),
    entry('page', '/for-partners', m.partnerSegments.hub.seoTitle, m.partnerSegments.hub.lead),
    ...(['courses', 'coworkings', 'communities', 'expats', 'banks'] as const).map((s) =>
      entry('page', `/for-${s}`, m.partnerSegments[s].seoTitle, m.partnerSegments[s].lead)
    ),
    entry('page', '/blog', m.blog.seoTitle, m.blog.lead)
  ];

  // Confidential mode: the page, plus its live demo, what the server sees and the code check on their own.
  const sec = m.securityPage;
  entries.push(
    entry('page', '/security/confidential', sec.seoTitle, sec.lead, `${sec.eyebrow} ${flat(sec.howSteps)} ${sec.limitsTitle} ${flat(sec.limits)}`),
    entry('page', '/security/confidential#demo', `${sec.demoTitle}: ${sec.title}`, sec.demoLead),
    entry('page', '/security/confidential#server', sec.visibleTitle, flat(sec.visible), `${sec.hiddenTitle} ${flat(sec.hidden)} ${sec.title}`),
    entry('page', '/security/confidential#csp', sec.cspTitle, sec.cspBody, `${sec.cspHow} ${sec.title}`),
    entry('page', '/security/confidential#verify', sec.verifyTitle, sec.verifyLead, `${flat(sec.planned)} ${sec.title}`)
  );

  // Comparisons and switching guides, for the brands of this locale's market (lib/competitors.ts).
  const compare = m.comparePage as unknown as { seoTitle: string; lead: string; brands: Record<string, { seoTitle: string; lead: string; suitsUs: string[]; suitsThem: string[] }> };
  entries.push(entry('page', '/compare', compare.seoTitle, compare.lead));
  for (const b of comparedBrandsFor(locale)) {
    const text = compare.brands[b.key];
    if (text) entries.push(entry('page', `/compare/${b.key}`, text.seoTitle, text.lead, `${b.name} ${flat(text.suitsUs)} ${flat(text.suitsThem)}`));
  }
  const switching = m.switchPage as unknown as { seoTitle: string; lead: string; brands: Record<string, { seoTitle: string; lead: string }> };
  entries.push(entry('page', '/switch', switching.seoTitle, switching.lead));
  for (const b of switchBrandsFor(locale)) {
    const text = switching.brands[b.key];
    if (text) entries.push(entry('page', `/switch/${b.key}`, text.seoTitle, text.lead, b.name));
  }

  // School lessons: hand-written content in cs/sk/en (contentLocale), Czech-only ones not offered elsewhere.
  for (const lesson of SCHOOL_LESSONS) {
    if (!lessonPublishedIn(lesson, locale)) continue;
    const content = await lessonContent(lesson.slug, locale);
    if (content) entries.push(entry('guide', `/for-schools/lessons/${lesson.slug}`, content.title, content.metaDescription));
  }
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
  // Glossary terms of this language (a Czech-only term has no Slovak text).
  const gloss = m.glossaryPages;
  entries.push(entry('page', '/glossary', gloss.indexTitle, gloss.indexDescription));
  for (const term of glossaryTermsFor(locale)) {
    const text = glossaryText(locale, term.slug);
    if (!text) continue;
    entries.push(entry('glossary', `/glossary/${term.slug}`, text.term, text.definition, `${text.aka ?? ''} ${text.explanation.join(' ')}`));
  }
  // Invoice templates: a document sample is closest to a guide.
  const templates = m.invoiceTemplates as unknown as { indexTitle: string; indexDescription: string; items: Record<string, ToolText & { title: string }> };
  entries.push(entry('page', '/invoice-templates', templates.indexTitle, templates.indexDescription));
  for (const x of TEMPLATES) {
    const text = templates.items[x.key];
    if (!text || !isPublishedIn(x, locale)) continue;
    entries.push(entry('guide', `/invoice-templates/${x.slug}`, text.title, text.description, `${text.name} ${text.lead ?? ''}`));
  }
  const reminders = m.paymentReminders as unknown as { indexTitle: string; indexDescription: string; items: Record<string, ToolText & { title: string }> };
  entries.push(entry('page', '/payment-reminder-templates', reminders.indexTitle, reminders.indexDescription));
  for (const x of REMINDERS) {
    const text = reminders.items[x.key];
    if (!text || !isPublishedIn(x, locale)) continue;
    entries.push(entry('guide', `/payment-reminder-templates/${x.slug}`, text.title, text.description, `${text.name} ${text.lead ?? ''}`));
  }
  return entries;
}

/**
 * Site search over the public pages and municipalities. Every query word
 * has to appear (as a prefix of a word) in the title or the text; title
 * hits rank first. Plain in-memory scan: a few hundred entries.
 */
export async function searchSite(locale: string, query: string, limit = 30): Promise<SearchHit[]> {
  // Any script's letters, not just a-z: a Ukrainian query is Cyrillic.
  const words = normalise(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  const has = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word}`, 'u').test(text);

  const scored: { hit: SearchHit; score: number }[] = [];
  for (const e of await indexFor(locale)) {
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
    if (all) scored.push({ hit: { kind: e.kind, href: e.href, title: e.title, snippet: e.snippet }, score: score + (e.kind === 'feature' || e.kind === 'calculator' || e.kind === 'guide' || e.kind === 'glossary' ? 1 : 0) });
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
