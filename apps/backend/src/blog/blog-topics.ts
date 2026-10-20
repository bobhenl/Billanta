import { checkInvoiceRequirements, lawUrl, type VatStatus } from "@faktur/cz-compliance";
import type { BlogSource } from "../../drizzle/schema";
import type { BlogTopics, TopicLocale } from "../../scripts/blog-topics-sync";
import topicsJson from "./blog-topics-data.json";

/**
 * Topics for the generated blog kinds that need no outside source: how to
 * use each public tool, and how to invoice as each kind of business (the
 * presets from onboarding). Every fact is built here from our own data: the
 * texts of our pages (blog-topics-data.json, synced from the frontend) and the
 * invoice requirements check from @faktur/cz-compliance. The model only
 * writes prose around them, and blog-checks.ts rejects any number or § that
 * is not in these facts.
 */
export const topics = topicsJson as BlogTopics;
export type { TopicLocale };
export const TOPIC_LOCALES: readonly TopicLocale[] = ["cs", "sk"];

export type TopicKind = "tool_howto" | "trade_invoicing";

export interface Topic {
  kind: TopicKind;
  locale: TopicLocale;
  /** Same slug in every locale, so it is also the translation key. */
  slug: string;
  /** What the article is about, for the prompt. */
  subject: string;
  facts: string;
  sources: BlogSource[];
}

/** Public URLs in facts and sources must be https; a local http SITE_URL falls back to production. */
export function siteUrl(): string {
  const url = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return /^https:\/\//.test(url) ? url : "https://billanta.com";
}

/** Readable trade slugs; every preset needs one (blog-topics.spec.ts). */
export const TRADE_SLUGS: Record<string, string> = {
  invoicingOnly: "invoicing-for-small-business",
  flatTax: "invoicing-for-flat-tax-freelancers",
  tradesman: "invoicing-for-tradespeople",
  withAccountant: "invoicing-with-an-accountant",
  eshop: "invoicing-for-e-shops",
};

/** Paušální daň is Czech only; a Slovak post about it would read as advice for Slovak businesses. */
const TRADE_LOCALES: Record<string, readonly TopicLocale[]> = { flatTax: ["cs"] };

const LAW_NAMES: Record<string, Record<TopicLocale, string>> = {
  OZ: { cs: "občanského zákoníku", sk: "Občianskeho zákonníka" },
  ObZ: { cs: "obchodního zákoníku", sk: "Obchodného zákonníka" },
  ZDPH: { cs: "zákona o DPH", sk: "zákona o DPH" },
  ZoDPH: { cs: "zákona o DPH", sk: "zákona o DPH" },
};

/** "§29/1 ZDPH" → "§ 29 odst. 1 zákona o DPH": the prose form blog-checks accepts. */
export function lawProse(rule: string, locale: TopicLocale): string {
  const m = /^§\s*(\d+[a-z]?)(?:\/(\d+)([a-z])?)?\s+(\w+)$/.exec(rule.trim());
  if (!m || !LAW_NAMES[m[4]!]) return rule;
  const odst = m[2] ? ` ${locale === "sk" ? "ods." : "odst."} ${m[2]}` : "";
  const pism = m[3] ? ` písm. ${m[3]})` : "";
  return `§ ${m[1]}${odst}${pism} ${LAW_NAMES[m[4]!]![locale]}`;
}

const LABELS: Record<TopicLocale, Record<string, string>> = {
  cs: {
    page: "Stránka nástroje na webu Billanta",
    link: "Odkaz na nástroj v článku",
    trade: "Typ podnikání",
    modules: "Co má tento typ v Billantě zapnuté",
    noModules: "Jen faktury a kontakty, žádné další moduly.",
    nonPayer: "Faktura neplátce DPH: co kontrola v Billantě hlídá",
    payer: "Faktura plátce DPH (daňový doklad): co kontrola v Billantě hlídá navíc",
    practical: "praktická kontrola, žádný zákon ji nevyžaduje",
    warning: "upozornění, doklad jde vystavit i tak",
    signup: "Registrace do Billanty (odkaz v článku)",
  },
  sk: {
    page: "Stránka nástroja na webe Billanta",
    link: "Odkaz na nástroj v článku",
    trade: "Typ podnikania",
    modules: "Čo má tento typ v Billante zapnuté",
    noModules: "Len faktúry a kontakty, žiadne ďalšie moduly.",
    nonPayer: "Faktúra neplatiteľa DPH: čo kontrola v Billante stráži",
    payer: "Faktúra platiteľa DPH (daňový doklad): čo kontrola v Billante stráži navyše",
    practical: "praktická kontrola, žiadny zákon ju nevyžaduje",
    warning: "upozornenie, doklad sa dá vystaviť aj tak",
    signup: "Registrácia do Billanty (odkaz v článku)",
  },
};

export function toolTopic(slug: string, locale: TopicLocale): Topic | null {
  const tool = topics.tools.find((t) => t.slug === slug);
  const text = tool?.texts[locale];
  if (!tool || !text) return null;
  const path = `/${tool.type === "calculator" ? "calculators" : "guides"}/${tool.slug}`;
  const url = `${siteUrl()}/${locale}${path}`;
  const l = LABELS[locale];
  return {
    kind: "tool_howto",
    locale,
    slug: `how-to-${tool.slug}`,
    subject: `How to use our free public tool "${text.name}" (${text.title}): what it is for, what to enter, how to read the result, and what to watch out for.`,
    facts: [`${text.title}`, text.description, ...text.lines.map((s) => `- ${s}`), `${l.page}: ${url}`, `${l.link}: ${path}`].join("\n"),
    sources: [{ title: `Billanta: ${text.name}`, url }],
  };
}

/** What the invoice requirements check reports for an empty invoice of a supplier with this status. */
function requirementLines(status: VatStatus, locale: TopicLocale): string[] {
  const country = locale === "sk" ? "SK" : "CZ";
  const issues = checkInvoiceRequirements({
    supplier: { legalName: "", address: { street: "", city: "", countryCode: country } } as never,
    vatStatus: status,
    taxDocument: true,
    lines: [{ description: "", quantity: 0 }],
  });
  const l = LABELS[locale];
  const texts = topics.requirements[locale];
  return issues.map((i) => {
    const why = i.rule ? lawProse(i.rule, locale) : l.practical;
    return `- ${texts[i.code] ?? i.code} (${why}${i.severity === "warning" ? `; ${l.warning}` : ""})`;
  });
}

export function tradeTopic(key: string, locale: TopicLocale): Topic | null {
  const preset = topics.presets.find((p) => p.key === key);
  const slug = TRADE_SLUGS[key];
  if (!preset || !slug || !(TRADE_LOCALES[key] ?? TOPIC_LOCALES).includes(locale)) return null;
  const l = LABELS[locale];
  const text = preset.texts[locale];
  const modules = preset.modules.map((m) => topics.modules[locale][m]).filter(Boolean);
  const civil = locale === "sk" ? "§3a ObZ" : "§435 OZ";
  const vat = locale === "sk" ? "§74/1 ZoDPH" : "§29/1 ZDPH";
  const signup = "/signup";
  return {
    kind: "trade_invoicing",
    locale,
    slug,
    subject: `How to invoice as this kind of business: "${text.title}" (${text.description}). What must be on the invoice, what Billanta checks before issuing it, and which parts of the app this kind of business uses.`,
    facts: [
      `${l.trade}: ${text.title}. ${text.description}`,
      `${l.modules}:`,
      ...(modules.length ? modules.map((m) => `- ${m!.title}: ${m!.description}`) : [`- ${l.noModules}`]),
      `${l.nonPayer}:`,
      ...requirementLines("non_payer", locale),
      `${l.payer}:`,
      ...requirementLines("payer", locale).filter((line) => !requirementLines("non_payer", locale).includes(line)),
      `${l.signup}: ${signup}`,
    ].join("\n"),
    sources: [
      { title: locale === "sk" ? "Obchodný zákonník" : "Občanský zákoník", url: lawUrl(civil)! },
      { title: locale === "sk" ? "Zákon o dani z pridanej hodnoty" : "Zákon o dani z přidané hodnoty", url: lawUrl(vat)! },
    ],
  };
}

/** Every topic of a kind in a locale, in the order they should appear on the blog. */
export function allTopics(kind: TopicKind, locale: TopicLocale): Topic[] {
  const list =
    kind === "tool_howto"
      ? topics.tools.map((t) => toolTopic(t.slug, locale))
      : topics.presets.map((p) => tradeTopic(p.key, locale));
  return list.filter((t): t is Topic => t !== null);
}

/** The first topic whose slug isn't taken yet, or null when the kind is exhausted for that locale. */
export function nextTopic(kind: TopicKind, locale: TopicLocale, existingSlugs: ReadonlySet<string>): Topic | null {
  return allTopics(kind, locale).find((t) => !existingSlugs.has(t.slug)) ?? null;
}
