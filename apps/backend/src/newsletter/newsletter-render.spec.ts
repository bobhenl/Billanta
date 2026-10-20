import { describe, expect, it } from "vitest";
import { buildNewsletterDraft } from "./newsletter-draft";
import { markdownToEmailHtml, renderNewsletterConfirmation, renderNewsletterIssue, safeLinkUrl } from "./newsletter-render";

describe("markdownToEmailHtml", () => {
  it("renders headings, lists, bold and links", () => {
    const html = markdownToEmailHtml("Úvod\n\n## Termíny\n- **25. 11.** – DPH\n- [Článek](https://example.com/a?x=1&y=2)");
    expect(html).toContain("<h2");
    expect(html).toContain("Termíny</h2>");
    expect(html).toContain('<strong style="color:#111;">25. 11.</strong>');
    expect(html).toContain('href="https://example.com/a?x=1&amp;y=2"');
    expect(html.match(/<li/g)).toHaveLength(2);
  });

  it("escapes raw HTML and refuses non-http links", () => {
    const html = markdownToEmailHtml('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror="y">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("makes site paths absolute", () => {
    expect(safeLinkUrl("/cs/blog/x")).toMatch(/^https?:\/\/[^/]+\/cs\/blog\/x$/);
    expect(safeLinkUrl("//evil.example/x")).toBeNull();
    expect(safeLinkUrl("mailto:a@b.cz")).toBeNull();
  });
});

describe("renderNewsletterIssue", () => {
  it("carries the 480/2004 footer: commercial, why, unsubscribe, sender", () => {
    const { html, text, subject } = renderNewsletterIssue(
      { subject: "Co se mění", body: "Text" },
      { locale: "cs", email: "jana@example.cz", unsubscribeUrl: "https://billanta.test/cs/unsubscribe/abc" },
    );
    expect(subject).toBe("Co se mění");
    expect(html).toContain("obchodní sdělení");
    expect(html).toContain("jana@example.cz");
    expect(html).toContain('href="https://billanta.test/cs/unsubscribe/abc"');
    expect(html).toContain("/cs/legal/privacy");
    expect(text).toContain("https://billanta.test/cs/unsubscribe/abc");
  });

  it("has the footer in Slovak and English too", () => {
    const opts = { email: "a@b.sk", unsubscribeUrl: "https://x.test/u" };
    expect(renderNewsletterIssue({ subject: "S", body: "B" }, { ...opts, locale: "sk" }).html).toContain("obchodná komunikácia");
    expect(renderNewsletterIssue({ subject: "S", body: "B" }, { ...opts, locale: "en" }).html).toContain("commercial communication");
  });
});

describe("renderNewsletterConfirmation", () => {
  it("links the confirmation page and says nothing is sent without it", () => {
    const { html, subject } = renderNewsletterConfirmation("sk", "https://billanta.test/sk/newsletter/confirm/tok");
    expect(subject).toContain("Potvrďte");
    expect(html).toContain('href="https://billanta.test/sk/newsletter/confirm/tok"');
    expect(html).toContain("Bez potvrdenia");
  });
});

describe("buildNewsletterDraft", () => {
  const now = new Date("2026-11-03T09:00:00Z");

  it("lists posts as blog links and deadlines with dates", () => {
    const draft = buildNewsletterDraft({
      locale: "cs",
      now,
      posts: [{ title: "E-faktura [SK]", description: "Co se mění\nod 2027", slug: "slovakia-e-invoicing-2027" }],
      deadlines: [{ label: "DPH a kontrolní hlášení", date: new Date("2026-11-25T12:00:00Z") }],
    });
    expect(draft.subject).toBe("Co se mění: listopad 2026");
    expect(draft.body).toContain("- **[E-faktura SK](/cs/blog/slovakia-e-invoicing-2027)** – Co se mění od 2027");
    expect(draft.body).toContain("25. 11. 2026 – DPH a kontrolní hlášení");
    expect(draft.body).not.toContain("—");
  });

  it("still gives something to edit when there is nothing new", () => {
    const draft = buildNewsletterDraft({ locale: "en", now, posts: [], deadlines: [] });
    expect(draft.body).toContain("Nothing major changes this month.");
  });
});
