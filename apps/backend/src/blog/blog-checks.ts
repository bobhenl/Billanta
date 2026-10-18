import type { BlogSource } from "../../drizzle/schema";

/**
 * Automatic blockers for a blog post, mostly aimed at AI drafts (VoxelRank's
 * contentDrafts did the same). A post with warnings can still be published,
 * but only with an explicit "publish anyway" and never automatically.
 *
 * The number check is the important one: the AI gets a list of facts built
 * by code, and any number in the text that isn't in those facts is most
 * likely invented (a wrong date or amount in a tax article is the worst
 * thing the blog could publish).
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
  "ušetříte na daních",
  "ušetríte na daniach",
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

const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;

/** Digit groups ("25", "2026", "385"), leading zeros dropped so 05 and 5 compare equal. */
function numbers(text: string): Set<string> {
  return new Set((text.match(/\d+/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, "")));
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
