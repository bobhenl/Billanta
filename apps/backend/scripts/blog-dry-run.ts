import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { autoPublishDecision } from "../src/blog/blog-autopublish";
import { blogWarnings } from "../src/blog/blog-checks";
import { MODEL, STYLE_RULES, TopicPostSchema, topicPost, topicPrompt, type TopicPostDraft } from "../src/blog/blog-prompts";
import { allTopics, TOPIC_LOCALES, type TopicKind, type TopicLocale } from "../src/blog/blog-topics";

/**
 * Builds one tool or trade post the way the weekly cron does, without a
 * database: prints the prompt, gets the model's draft, then runs the checks
 * and the auto-publish decision (as if the kind were switched on).
 *
 *   cd apps/backend
 *   npx ts-node --transpile-only scripts/blog-dry-run.ts --kind tool_howto --locale cs [--topic how-to-<slug>]
 *
 * With ANTHROPIC_API_KEY set it calls Claude; otherwise pass the model's
 * JSON answer ({ title, description, body }) with --response file.json.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function draftFor(parts: string[]): Promise<TopicPostDraft> {
  const file = arg("response");
  if (file) return TopicPostSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("Set ANTHROPIC_API_KEY or pass --response file.json");
  const response = await new Anthropic().beta.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(TopicPostSchema) },
    system: STYLE_RULES,
    messages: [{ role: "user", content: parts.join("\n\n") }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error(`No draft (stop_reason ${response.stop_reason})`);
  return response.parsed_output;
}

async function main() {
  const kind = (arg("kind") ?? "tool_howto") as TopicKind;
  const locale = (arg("locale") ?? "cs") as TopicLocale;
  if (!["tool_howto", "trade_invoicing"].includes(kind) || !TOPIC_LOCALES.includes(locale)) throw new Error("--kind tool_howto|trade_invoicing --locale cs|sk");
  const list = allTopics(kind, locale);
  const topic = arg("topic") ? list.find((t) => t.slug === arg("topic")) : list[0];
  if (!topic) throw new Error(`No topic. Available: ${list.map((t) => t.slug).join(", ")}`);

  const parts = topicPrompt(topic);
  console.log(`=== Prompt (${MODEL}) ===\n${parts.join("\n\n")}\n`);

  const post = topicPost(topic, await draftFor(parts));
  const warnings = blogWarnings(post);
  const verdict = autoPublishDecision({ kind, enabled: true, warnings, post, publishedThisWeek: 0 });

  console.log(`=== Draft ${post.locale}/${post.slug} ===\n# ${post.title}\n\n${post.description}\n\n${post.body}\n`);
  console.log(`Sources: ${post.sources.map((s) => s.url).join(", ")}`);
  console.log(`Warnings: ${warnings.length ? warnings.join(", ") : "none"}`);
  console.log(`Auto-publish (if switched on): ${verdict.publish ? "yes" : `no, ${verdict.reason}`}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
