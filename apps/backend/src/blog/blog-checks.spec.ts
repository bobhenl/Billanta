import { describe, expect, it } from "vitest";
import { blogWarnings, type CheckablePost } from "./blog-checks";

const sentence = "Přiznání k DPH za říjen podáváte elektronicky přes portál MOJE daně nebo datovou schránkou. ";

function post(overrides: Partial<CheckablePost> = {}): CheckablePost {
  return {
    title: "Daňové termíny v listopadu 2026",
    description: "Kdy v listopadu 2026 podat přiznání k DPH, kontrolní hlášení a zaplatit paušální zálohu.",
    body: `Do 25. 11. 2026 podáte přiznání k DPH.\n\n## Termíny\n\n- **25. 11.** kontrolní hlášení\n\n${sentence.repeat(10).trim()}`,
    sources: [{ title: "Finanční správa ČR", url: "https://financnisprava.gov.cz/" }],
    facts: "2026-11-25 – DPH – přiznání a kontrolní hlášení",
    ...overrides,
  };
}

describe("blogWarnings", () => {
  it("passes a clean post", () => {
    expect(blogWarnings(post())).toEqual([]);
  });

  it("flags a number that is not in the facts", () => {
    expect(blogWarnings(post({ body: post().body.replace("25. 11. 2026", "26. 11. 2026") }))).toContain("unknown_number");
  });

  it("ignores digits in link targets but not in link text", () => {
    const withLink = `${post().body} Více na [portálu](https://example.com/2099/x).`;
    expect(blogWarnings(post({ body: withLink }))).toEqual([]);
    expect(blogWarnings(post({ body: `${post().body} Viz [rok 2099](https://example.com/).` }))).toContain("unknown_number");
  });

  it("skips the number check without facts (hand-written posts)", () => {
    expect(blogWarnings(post({ facts: null, body: post().body.replace("2026", "2031") }))).toEqual([]);
  });

  it("flags promises, raw HTML, cut-off text and missing sources", () => {
    expect(blogWarnings(post({ body: `${post().body} Garantujeme, že nic nezmeškáte.` }))).toContain("banned_phrase");
    expect(blogWarnings(post({ body: `${post().body} <script>x</script>.` }))).toContain("raw_html");
    expect(blogWarnings(post({ body: `${post().body} a pak` }))).toContain("body_truncated");
    expect(blogWarnings(post({ sources: [] }))).toContain("no_sources");
    expect(blogWarnings(post({ body: "Krátké." }))).toContain("body_too_short");
  });

  it("allows only https and site-relative links", () => {
    expect(blogWarnings(post({ body: `${post().body} [x](javascript:alert)` }))).toContain("bad_link");
    expect(blogWarnings(post({ body: `${post().body} [x](http://example.com).` }))).toContain("bad_link");
    expect(blogWarnings(post({ body: `${post().body} [Kalkulačky](/calculators).` }))).toEqual([]);
  });
});
