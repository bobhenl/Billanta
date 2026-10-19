import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBlogTopics, FRONTEND_DIR, TOPICS_FILE } from "../../scripts/blog-topics-sync";
import { blogWarnings } from "./blog-checks";
import { allTopics, lawProse, nextTopic, TOPIC_LOCALES, topics, TRADE_SLUGS, tradeTopic, toolTopic } from "./blog-topics";

describe("blog-topics-data.json", () => {
  it("is in sync with the frontend (run scripts/blog-topics-sync.ts)", () => {
    expect(JSON.parse(readFileSync(TOPICS_FILE, "utf8"))).toEqual(buildBlogTopics(FRONTEND_DIR));
  });

  it("has a slug for every business preset", () => {
    for (const p of topics.presets) expect(TRADE_SLUGS[p.key], p.key).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("lawProse", () => {
  it("writes rule ids the way blog-checks accepts them", () => {
    expect(lawProse("§435 OZ", "cs")).toBe("§ 435 občanského zákoníku");
    expect(lawProse("§29/1 ZDPH", "cs")).toBe("§ 29 odst. 1 zákona o DPH");
    expect(lawProse("§29/1c ZDPH", "cs")).toBe("§ 29 odst. 1 písm. c) zákona o DPH");
    expect(lawProse("§3a ObZ", "sk")).toBe("§ 3a Obchodného zákonníka");
    expect(lawProse("§74/1 ZoDPH", "sk")).toBe("§ 74 ods. 1 zákona o DPH");
  });
});

describe("topics", () => {
  it("follow each tool's locales: Czech-rule tools have no Slovak post", () => {
    expect(toolTopic("flat-tax", "cs")).not.toBeNull();
    expect(toolTopic("flat-tax", "sk")).toBeNull();
    expect(toolTopic("due-date", "sk")?.slug).toBe("how-to-due-date");
    expect(tradeTopic("flatTax", "sk")).toBeNull();
  });

  it("put the paragraphs from the requirements check into the trade facts", () => {
    const cs = tradeTopic("tradesman", "cs")!;
    expect(cs.facts).toContain("§ 435 občanského zákoníku");
    expect(cs.facts).toContain("§ 29 odst. 1 zákona o DPH");
    const sk = tradeTopic("tradesman", "sk")!;
    expect(sk.facts).toContain("§ 3a Obchodného zákonníka");
    expect(sk.facts).toContain("§ 74 ods. 1 zákona o DPH");
    expect(sk.facts).not.toMatch(/občanského|zákoníku/);
  });

  it("give every topic https sources and no em dash in the facts", () => {
    for (const kind of ["tool_howto", "trade_invoicing"] as const) {
      for (const locale of TOPIC_LOCALES) {
        for (const t of allTopics(kind, locale)) {
          expect(t.sources.length).toBeGreaterThan(0);
          for (const s of t.sources) expect(s.url).toMatch(/^https:\/\//);
          expect(t.facts.includes("\u2014"), t.slug).toBe(false);
        }
      }
    }
  });

  it("let a post that quotes its facts pass the § and number checks", () => {
    for (const t of [...allTopics("trade_invoicing", "cs"), ...allTopics("tool_howto", "sk")]) {
      const warnings = blogWarnings({ title: t.subject, description: t.subject, body: t.facts, sources: t.sources, facts: t.facts });
      expect(warnings.filter((w) => w === "law_reference" || w === "unknown_number"), t.slug).toEqual([]);
    }
  });

  it("skip topics that already have a post", () => {
    const first = nextTopic("tool_howto", "cs", new Set())!;
    expect(nextTopic("tool_howto", "cs", new Set([first.slug]))!.slug).not.toBe(first.slug);
    expect(nextTopic("trade_invoicing", "cs", new Set(allTopics("trade_invoicing", "cs").map((t) => t.slug)))).toBeNull();
  });
});
