import type { EmailLocale } from "../email/email-render";

/**
 * A starting point for an issue, built from what already exists: posts
 * published on the blog since the last issue and the tax deadlines coming
 * up. No text generator of its own: the blog (and its draft pipeline) is
 * where articles are written; the issue only points at them. The admin
 * edits the result before anything is sent.
 */
export interface DraftPost {
  title: string;
  description: string;
  slug: string;
}

export interface DraftDeadline {
  label: string;
  date: Date;
}

const T: Record<
  EmailLocale,
  { subject: (month: string) => string; intro: string; posts: string; deadlines: string; deadlinesNote: string; outro: string; empty: string }
> = {
  cs: {
    subject: (m) => `Co se mění: ${m}`,
    intro: "Krátký přehled toho, co se mění v daních, limitech a fakturaci a co vás čeká v příštích týdnech.",
    posts: "Nové na blogu",
    deadlines: "Daňové termíny v příštích 30 dnech",
    deadlinesNote: "Termíny platí pro Česko. Ne všechny se týkají každého, záleží na tom, jestli jste plátce DPH, OSVČ nebo firma.",
    outro: "Na všechny termíny vám Billanta připomene i v aplikaci.",
    empty: "Tento měsíc se nic zásadního nemění.",
  },
  sk: {
    subject: (m) => `Čo sa mení: ${m}`,
    intro: "Krátky prehľad toho, čo sa mení v daniach, limitoch a fakturácii a čo vás čaká v najbližších týždňoch.",
    posts: "Nové na blogu",
    deadlines: "Daňové termíny v najbližších 30 dňoch (Česko)",
    deadlinesNote: "Termíny platia pre Česko. Nie všetky sa týkajú každého, závisí to od toho, či ste platiteľ DPH, SZČO alebo firma.",
    outro: "Na všetky termíny vám Billanta pripomenie aj v aplikácii.",
    empty: "Tento mesiac sa nič zásadné nemení.",
  },
  en: {
    subject: (m) => `What's changing: ${m}`,
    intro: "A short summary of what is changing in taxes, limits and invoicing, and what is coming up in the next few weeks.",
    posts: "New on the blog",
    deadlines: "Czech tax deadlines in the next 30 days",
    deadlinesNote: "These are Czech deadlines. Not all of them apply to everyone: it depends on whether you are a VAT payer, self-employed or a company.",
    outro: "Billanta reminds you of every deadline in the app as well.",
    empty: "Nothing major changes this month.",
  },
};

const INTL: Record<EmailLocale, string> = { cs: "cs-CZ", sk: "sk-SK", en: "en-GB" };

export function buildNewsletterDraft(input: {
  locale: EmailLocale;
  now: Date;
  posts: DraftPost[];
  deadlines: DraftDeadline[];
}): { subject: string; body: string } {
  const t = T[input.locale];
  const month = new Intl.DateTimeFormat(INTL[input.locale], { month: "long", year: "numeric", timeZone: "Europe/Prague" }).format(input.now);
  const day = new Intl.DateTimeFormat(INTL[input.locale], { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Prague" });
  const parts: string[] = [t.intro];
  if (input.posts.length) {
    parts.push(
      `## ${t.posts}\n${input.posts
        .map((p) => `- **[${oneLine(p.title)}](/${input.locale}/blog/${p.slug})** – ${oneLine(p.description)}`)
        .join("\n")}`,
    );
  }
  if (input.deadlines.length) {
    parts.push(`## ${t.deadlines}\n${input.deadlines.map((d) => `- ${day.format(d.date)} – ${oneLine(d.label)}`).join("\n")}`, t.deadlinesNote);
  }
  if (!input.posts.length && !input.deadlines.length) parts.push(t.empty);
  parts.push(t.outro);
  return { subject: t.subject(month), body: parts.join("\n\n") };
}

/** Markdown-safe single line: no line breaks, no brackets that would end a link label. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
