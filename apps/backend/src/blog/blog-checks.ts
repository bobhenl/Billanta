import { isKnownLawName } from "@faktur/cz-compliance";
import type { BlogSource } from "../../drizzle/schema";

/**
 * Automatic blockers for a blog post, mostly aimed at AI drafts (VoxelRank's
 * contentDrafts did the same). A post with warnings can still be published,
 * but only with an explicit "publish anyway" and never automatically.
 *
 * The number and law checks are the important ones: the AI gets a list of
 * facts built by code, and any number or § in the text that isn't in those
 * facts is most likely invented (a wrong date, amount or paragraph in a tax
 * article is the worst thing the blog could publish).
 */
export interface CheckablePost {
  title: string;
  description: string;
  body: string;
  sources: BlogSource[];
  facts?: string | null;
}

export const BODY_MIN_LENGTH = 800;

/** Promises we never make, in any of the three languages (lowercase). */
const BANNED_PHRASES = [
  "garantujeme",
  "zaručujeme",
  "zaručeně",
  "zaručene",
  "garantovan",
  "garantujem",
  "ušetříte na daních",
  "ušetríte na daniach",
  // Tax-saving promises: general information, never advice that lowers your tax.
  "ušetříte na dani",
  "ušetríte na dani",
  "ušetřit na daních",
  "ušetriť na daniach",
  "snížíte daň",
  "znížite daň",
  "zaplatíte méně",
  "zaplatíte menej",
  "nižší daně",
  "nižšie dane",
  "daňový trik",
  "daňové triky",
  "bez rizika",
  "save on tax",
  "save tax",
  "pay less tax",
  "lower your tax",
  "risk-free",
  "vyhnete se kontrole",
  "vyhnete sa kontrole",
  "nikdy nemusíte",
  "nikdy nebudete muset",
  "we guarantee",
  "guaranteed",
  "never have to",
  "jako ai",
  "ako ai",
  "as an ai",
  "jazykový model",
  "language model",
];

/**
 * Absolutes a tax text can rarely back up. Allowed only when the facts use
 * the word too (the official text may say "vždy měsíčně").
 */
const ABSOLUTE_WORDS = ["vždy", "vždycky", "nikdy", "always", "never"];

/** Signs the post is about a law that is changing: those always wait for a person. */
const LEGISLATIVE = [
  /(?<!\p{L})novel(?:a|y|u|e|ou|izac|izuj)/iu,
  /(?<!\p{L})zm[ěe]n\p{L}* z[áa]kon/iu,
  /(?<!\p{L})nov\p{L}* z[áa]kon/iu,
  /(?<!\p{L})legislativ/iu,
  /(?<!\p{L})[úu][čc]innost/iu,
  /(?<!\p{L})amend/iu,
  /(?<!\p{L})(?:new|proposed) (?:law|act|rules)(?!\p{L})/iu,
  /(?<!\p{L})(?:takes|come|comes|came) into (?:effect|force)(?!\p{L})/iu,
];

const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;

/** Digit groups ("25", "2026", "385"), leading zeros dropped so 05 and 5 compare equal. */
function numbers(text: string): Set<string> {
  return new Set((text.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, "")));
}

const word = (w: string) => new RegExp(String.raw`(?<!\p{L})${w}(?!\p{L})`, "iu");

/** "odst. 1", "písm. c)", "/1c", "a § 30": what can stand between "§ 29" and the law's name. */
const PARAGRAPH_TAIL = /^(?:\s*\/\s*\d+[a-z]?|\s*,?\s*(?:odst\.|ods\.|odsek|odstavec|písm\.|pism\.|section|para\.)\s*[0-9a-z]+\)?|\s*(?:,|a|and|or|nebo|alebo)\s*§\s*\d+[a-z]?)+/iu;

/**
 * Every "§ N" must name a law from law-links (so readers get a link we trust)
 * and, when facts are given, the paragraph itself must be in them.
 */
function badLawReference(text: string, facts: string | null | undefined): boolean {
  const inFacts = new Set([...(facts ?? "").matchAll(/§\s*(\d+[a-z]?)/giu)].map((m) => m[1]!.toLowerCase()));
  for (const m of text.matchAll(/§\s*(\d+[a-z]?)/giu)) {
    if (facts != null && !inFacts.has(m[1]!.toLowerCase())) return true;
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 120);
    const name = after.replace(PARAGRAPH_TAIL, "");
    if (!isKnownLawName(name)) return true;
  }
  return false;
}

/** True when the post is about legislation changing. Such posts are never published automatically. */
export function isLegislativeTopic(post: Pick<CheckablePost, "title" | "description" | "body">): boolean {
  const all = `${post.title}\n${post.description}\n${post.body}`;
  return LEGISLATIVE.some((re) => re.test(all));
}

export function blogWarnings(post: CheckablePost): string[] {
  const warnings: string[] = [];
  const title = post.title.trim();
  const description = post.description.trim();
  const body = post.body.trim();

  if (title.length < 10 || title.length > 140) warnings.push("title_length");
  if (description.length < 50 || description.length > 320) warnings.push("description_length");
  if (body.length < BODY_MIN_LENGTH) warnings.push("body_too_short");
  // A cut-off answer (max_tokens) ends mid-sentence.
  if (body && !/[.!?:)"“”»]$/.test(body)) warnings.push("body_truncated");
  if (post.sources.length === 0) warnings.push("no_sources");

  const all = `${title}\n${description}\n${body}`;
  const lower = all.toLowerCase();
  if (BANNED_PHRASES.some((p) => lower.includes(p))) warnings.push("banned_phrase");
  const facts = post.facts ?? "";
  if (ABSOLUTE_WORDS.some((w) => word(w).test(all) && !word(w).test(facts))) warnings.push("absolute_claim");
  // The house style is the en dash "–"; an em dash is a typical sign of unedited AI text.
  if (all.includes("\u2014")) warnings.push("em_dash");
  if (badLawReference(all.replace(LINK, "$1"), post.facts)) warnings.push("law_reference");
  if (/<\/?[a-z][^>]*>/i.test(all)) warnings.push("raw_html");
  for (const [, , url] of body.matchAll(LINK)) {
    if (!/^https:\/\/[^\s]+$/i.test(url ?? "") && !/^\/[a-z0-9/_-]*$/i.test(url ?? "")) {
      warnings.push("bad_link");
      break;
    }
  }

  if (post.facts != null) {
    const known = numbers(`${post.facts}\n${post.sources.map((s) => s.title).join("\n")}`);
    // Link targets are checked above; their digits are not claims.
    const prose = all.replace(LINK, "$1");
    if ([...numbers(prose)].some((n) => !known.has(n))) warnings.push("unknown_number");
  }

  return warnings;
}
