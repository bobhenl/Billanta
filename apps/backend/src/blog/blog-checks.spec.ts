import { describe, expect, it } from "vitest";
import { blogWarnings, isLegislativeTopic, type CheckablePost } from "./blog-checks";

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

  it("flags tax-saving promises in cs, sk and en", () => {
    for (const promise of ["S paušálem ušetříte na daních.", "Takto ušetríte na daniach.", "This way you pay less tax.", "Je to bez rizika."]) {
      expect(blogWarnings(post({ body: `${post().body} ${promise}` })), promise).toContain("banned_phrase");
    }
    expect(blogWarnings(post({ body: `${post().body} S kalkulačkou ušetříte čas.` }))).toEqual([]);
  });

  it("flags vždy / nikdy / always unless the facts say it too", () => {
    expect(blogWarnings(post({ body: `${post().body} Přiznání se vždy podává elektronicky.` }))).toContain("absolute_claim");
    expect(blogWarnings(post({ body: `${post().body} You never pay late.` }))).toContain("absolute_claim");
    const facts = `${post().facts}\nPrávnické osoby podávají kontrolní hlášení vždy měsíčně.`;
    expect(blogWarnings(post({ facts, body: `${post().body} Právnické osoby ho podávají vždy měsíčně.` }))).toEqual([]);
    // Only whole words: "vždyť" is not "vždy".
    expect(blogWarnings(post({ body: `${post().body} Vždyť je to snadné.` }))).toEqual([]);
  });

  it("flags the em dash but not the en dash", () => {
    expect(blogWarnings(post({ body: `${post().body} Termín \u2014 25. 11. 2026.` }))).toContain("em_dash");
    expect(blogWarnings(post({ title: "Daňové termíny \u2014 listopad 2026" }))).toContain("em_dash");
    expect(blogWarnings(post({ body: `${post().body} Termín – 25. 11. 2026.` }))).toEqual([]);
  });

  it("accepts a § from the facts that names a law in law-links", () => {
    const facts = `${post().facts}\nFaktura musí obsahovat údaje podle § 435 OZ a § 29 odst. 1 ZDPH.`;
    for (const ref of ["§ 435 občanského zákoníku", "§ 29 odst. 1 zákona o DPH", "§ 29/1 ZDPH", "§ 435 a § 29 zákona o DPH"]) {
      expect(blogWarnings(post({ facts, body: `${post().body} Viz ${ref}.` })), ref).toEqual([]);
    }
  });

  it("flags a § that is not in the facts or names a law without a link", () => {
    const facts = `${post().facts}\nLhůta se posouvá podle § 33 daňového řádu. Údaje podle § 435 OZ.`;
    expect(blogWarnings(post({ facts, body: `${post().body} Viz § 436 občanského zákoníku.` }))).toContain("law_reference");
    expect(blogWarnings(post({ facts, body: `${post().body} Lhůta se posouvá podle § 33 daňového řádu.` }))).toContain("law_reference");
    expect(blogWarnings(post({ facts, body: `${post().body} Viz § 435.` }))).toContain("law_reference");
    // Hand-written posts (no facts) still may only cite the linked laws.
    expect(blogWarnings(post({ facts: null, body: `${post().body} Viz § 7 zákona o daních z příjmů.` }))).toContain("law_reference");
    expect(blogWarnings(post({ facts: null, body: `${post().body} Viz § 3a Obchodného zákonníka.` }))).toEqual([]);
  });
});

describe("isLegislativeTopic", () => {
  it("spots posts about a law that is changing", () => {
    expect(isLegislativeTopic(post({ title: "Novela zákona o DPH od roku 2027" }))).toBe(true);
    expect(isLegislativeTopic(post({ body: "Od januára sa mení zákon. Zmena zákona o DPH prináša…" }))).toBe(true);
    expect(isLegislativeTopic(post({ body: "The new law takes effect in January." }))).toBe(true);
    expect(isLegislativeTopic(post({ description: "Co přináší účinnost nových pravidel pro OSVČ, krok za krokem." }))).toBe(true);
  });

  it("leaves ordinary how-tos alone", () => {
    expect(isLegislativeTopic(post())).toBe(false);
    expect(isLegislativeTopic(post({ body: "Kalkulačka spočítá splatnost faktury. Nové faktury vystavíte za minutu." }))).toBe(false);
  });
});
