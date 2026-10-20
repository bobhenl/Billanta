import type { BlogPostKind } from "../../drizzle/schema";
import { isLegislativeTopic, type CheckablePost } from "./blog-checks";

/**
 * Kinds that may go live without a click, each behind its own switch in /admin/blog.
 * Briefs and hand-written posts never do, and neither do tax deadline posts: a wrong
 * date there costs a reader a fine, so a person checks every one against the calendar.
 */
export const AUTO_PUBLISH_KINDS = ["tool_howto", "trade_invoicing"] as const satisfies readonly BlogPostKind[];
export type AutoPublishKind = (typeof AUTO_PUBLISH_KINDS)[number];

/** Auto-published posts per locale per rolling week, so readers (and Google) see a steady pace, not a dump. */
export const WEEKLY_AUTOPUBLISH_LIMIT = 3;

export type AutoPublishVerdict =
  | { publish: true }
  | { publish: false; reason: "kind_not_auto" | "switched_off" | "has_warnings" | "legislative" | "weekly_limit" };

/**
 * Whether a fresh draft may skip the review queue. The order matters only
 * for the logged reason; any one of these keeps the draft for a person:
 * a failed check, a post about a changing law, or the weekly cap.
 */
export function autoPublishDecision(input: {
  kind: BlogPostKind;
  enabled: boolean;
  warnings: readonly string[];
  post: Pick<CheckablePost, "title" | "description" | "body">;
  publishedThisWeek: number;
}): AutoPublishVerdict {
  if (!(AUTO_PUBLISH_KINDS as readonly string[]).includes(input.kind)) return { publish: false, reason: "kind_not_auto" };
  if (!input.enabled) return { publish: false, reason: "switched_off" };
  if (input.warnings.length > 0) return { publish: false, reason: "has_warnings" };
  if (isLegislativeTopic(input.post)) return { publish: false, reason: "legislative" };
  if (input.publishedThisWeek >= WEEKLY_AUTOPUBLISH_LIMIT) return { publish: false, reason: "weekly_limit" };
  return { publish: true };
}
