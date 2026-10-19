import { z } from "zod/v4";
import type { BlogLocale } from "./blog.service";
import type { Topic } from "./blog-topics";

/** Prompts and output shapes for AI blog drafts. Pure, so scripts/blog-dry-run.ts can build the same request. */
export const MODEL = process.env.AI_MODEL ?? "claude-opus-5-5";

export const LOCALE_NAMES: Record<BlogLocale, string> = {
  cs: "Czech",
  sk: "Slovak (real Slovak written by a native speaker, not Czech with a few words changed)",
  en: "English",
};

export const STYLE_RULES = `You write articles for the blog of Billanta, an invoicing app for Czech and Slovak sole traders and small companies.

Rules:
- Use ONLY the facts given in <facts>. Never add a date, amount, rate, paragraph number or law number that is not in the facts. If something is not in the facts, leave it out.
- Cite a paragraph (§) only if it is in the facts, written the same way, followed by the name of the law (for example "§ 435 občanského zákoníku").
- No promises: never write that the reader saves tax, pays less, is guaranteed anything or never has to do something. Avoid "always" and "never" (vždy, nikdy). This is general information, not tax advice.
- Plain, friendly, concrete. Short sentences. No marketing superlatives, no emoji.
- For dashes use the en dash "–" with spaces around it. Never use the em dash.
- Formatting is a restricted markdown: plain paragraphs, "## " headings, "- " bullet lists, **bold**. Links only as [text](https://...) or [text](/path), and only to URLs or paths given in the facts or sources. No HTML, no tables, no images.
- Mention Billanta at most once or twice, briefly and without claims beyond what the facts say.`;

export const TaxPostSchema = z.object({
  title: z.string().describe("Headline, under 90 characters, containing the month and year"),
  description: z.string().describe("Meta description, 120-200 characters"),
  intro: z.string().describe("One or two short paragraphs introducing the month's deadlines"),
  tips: z.array(z.string()).describe("Two to four practical reminders, one sentence each, no new numbers"),
  closing: z.string().describe("One short closing paragraph ending with a full stop"),
});

export const BriefPostSchema = z.object({
  slug: z.string().describe("English kebab-case URL slug, at most 80 characters"),
  title: z.string().describe("Headline, under 100 characters"),
  description: z.string().describe("Meta description, 120-200 characters"),
  body: z.string().describe("The article in restricted markdown, 600-1200 words, ending with a full stop"),
});

export const TopicPostSchema = z.object({
  title: z.string().describe("Headline, under 90 characters"),
  description: z.string().describe("Meta description, 120-200 characters"),
  body: z.string().describe("The article in restricted markdown, 400-900 words, with two to four ## headings, ending with a full stop"),
});
export type TopicPostDraft = z.infer<typeof TopicPostSchema>;

const KIND_GUIDANCE: Record<Topic["kind"], string> = {
  tool_howto:
    "Explain when the tool helps, what to enter, how to read the result and what to watch out for, using the facts. Link to the tool once, with the path given in the facts as the link target.",
  trade_invoicing:
    "Explain what must be on an invoice for this kind of business and why, citing the paragraphs exactly as the facts give them, then what Billanta checks before the invoice is issued and which parts of the app this kind of business uses. Keep the non-payer and the VAT payer parts apart. You may link to the sign-up path given in the facts once, at the end.",
};

/** The user message for a topic post: what to write, then the facts. */
export function topicPrompt(topic: Topic): string[] {
  return [
    `Write a blog article in ${LOCALE_NAMES[topic.locale]}. Write it natively in that language; do not translate.`,
    `<topic>\n${topic.subject}\n</topic>`,
    KIND_GUIDANCE[topic.kind],
    `<facts>\n${topic.facts}\n\nSources:\n${topic.sources.map((s) => `${s.title}: ${s.url}`).join("\n")}\n</facts>`,
  ];
}

/** The model's draft plus the topic's own slug, facts and sources: what BlogService.create stores. */
export function topicPost(topic: Topic, draft: TopicPostDraft) {
  return {
    locale: topic.locale,
    slug: topic.slug,
    translation_key: topic.slug,
    title: draft.title.trim(),
    description: draft.description.trim(),
    body: draft.body.trim(),
    sources: topic.sources,
    facts: topic.facts,
  };
}
