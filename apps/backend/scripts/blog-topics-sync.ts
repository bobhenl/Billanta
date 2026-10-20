import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds src/blog/blog-topics-data.json: the facts the blog generator writes
 * "how to use <tool>" and "how to invoice as <trade>" posts from. They come
 * from the frontend (lib/public-tools.ts, lib/business-presets.ts and the
 * cs/sk messages), which the backend image doesn't contain, so they are
 * copied here. blog-topics.spec.ts fails when the copy is stale:
 *
 *   cd apps/backend && npx ts-node --transpile-only scripts/blog-topics-sync.ts
 */

export const TOPIC_LOCALES = ["cs", "sk"] as const;
export type TopicLocale = (typeof TOPIC_LOCALES)[number];

export interface ToolTopic {
  slug: string;
  key: string;
  type: "calculator" | "guide";
  locales: TopicLocale[];
  /** name, title, description + every other sentence of the page, per locale. */
  texts: Partial<Record<TopicLocale, { name: string; title: string; description: string; lines: string[] }>>;
}

export interface PresetTopic {
  key: string;
  modules: string[];
  texts: Record<TopicLocale, { title: string; description: string }>;
}

export interface BlogTopics {
  tools: ToolTopic[];
  presets: PresetTopic[];
  modules: Record<TopicLocale, Record<string, { title: string; description: string }>>;
  /** invoice requirement code → the text the invoice editor shows. */
  requirements: Record<TopicLocale, Record<string, string>>;
}

/** Page parts that are UI (form labels, result templates), not statements about the topic. */
const SKIP_KEYS = new Set(["keywords", "fields", "result", "errors", "unavailable", "countries", "options", "code", "perUnit", "listDate", "tableTitle", "date", "app"]);

/** ICU templates ("{n, plural, ...}") are UI, and a sentence with a hole in it is no fact. */
function sentences(value: unknown, key = ""): string[] {
  if (SKIP_KEYS.has(key)) return [];
  if (typeof value === "string") return value.includes("{") ? [] : [value.replace(/\u2014/g, "–").trim()];
  if (Array.isArray(value)) return value.flatMap((v) => sentences(v));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => sentences(v, k));
  return [];
}

function parseTools(source: string, list: "CALCULATORS" | "GUIDES") {
  const block = new RegExp(`export const ${list} = \\[([\\s\\S]*?)\\] as const`).exec(source)?.[1] ?? "";
  return [...block.matchAll(/\{\s*slug: '([^']+)', key: '([^']+)', icon: \w+, locales: (ALL|CZ_ONLY) \}/g)].map((m) => ({
    slug: m[1]!,
    key: m[2]!,
    locales: (m[3] === "ALL" ? ["cs", "sk"] : ["cs"]) as TopicLocale[],
  }));
}

export function buildBlogTopics(frontendDir: string): BlogTopics {
  const read = (p: string) => readFileSync(join(frontendDir, p), "utf8");
  const messages = Object.fromEntries(TOPIC_LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))])) as Record<TopicLocale, any>;
  const toolsSource = read("lib/public-tools.ts");

  const tools: ToolTopic[] = (["CALCULATORS", "GUIDES"] as const).flatMap((list) =>
    parseTools(toolsSource, list).map((t) => {
      const type = list === "CALCULATORS" ? "calculator" : "guide";
      const texts: ToolTopic["texts"] = {};
      for (const l of t.locales) {
        const item = messages[l].tools[type === "calculator" ? "calculators" : "guides"].items[t.key];
        const { name, title, description, ...rest } = item;
        texts[l] = { name, title, description, lines: sentences(rest) };
      }
      return { ...t, type, texts };
    }),
  );

  const presetsSource = read("lib/business-presets.ts");
  const presets: PresetTopic[] = [...presetsSource.matchAll(/\{ key: '([^']+)', modules: \{([^}]*)\} \}/g)].map((m) => ({
    key: m[1]!,
    modules: [...m[2]!.matchAll(/(\w+): true/g)].map((x) => x[1]!),
    texts: Object.fromEntries(
      TOPIC_LOCALES.map((l) => {
        const p = messages[l].settings.modules.presets[m[1]!];
        return [l, { title: p.title, description: p.description.replace(/\u2014/g, "–") }];
      }),
    ) as PresetTopic["texts"],
  }));

  return {
    tools,
    presets,
    modules: Object.fromEntries(TOPIC_LOCALES.map((l) => [l, messages[l].settings.modules.items])) as BlogTopics["modules"],
    requirements: Object.fromEntries(TOPIC_LOCALES.map((l) => [l, messages[l].doc.requirements.code])) as BlogTopics["requirements"],
  };
}

export const TOPICS_FILE = join(__dirname, "../src/blog/blog-topics-data.json");
export const FRONTEND_DIR = join(__dirname, "../../frontend");

if (require.main === module) {
  writeFileSync(TOPICS_FILE, `${JSON.stringify(buildBlogTopics(FRONTEND_DIR), null, 2)}\n`);
  console.log(`Wrote ${TOPICS_FILE}`);
}
