import { describe, expect, it } from "vitest";
import { htmlToText, renderNotificationEmail } from "./email-render";

const item = (title: string, extra: Partial<{ kind: string; body: string; url: string }> = {}) => ({
  kind: extra.kind ?? "invoice_paid",
  title,
  body: extra.body ?? null,
  url: extra.url ?? null,
  at: "2026-10-14T10:00:00Z",
});

describe("htmlToText", () => {
  it("keeps link targets, line breaks and decoded entities", () => {
    const html = `<html><head><style>p{}</style></head><body><h1>Faktura &amp; spol.</h1><p>Řádek 1<br>Řádek 2</p>
      <p><a href="https://x.cz/i/abc?a=1&amp;b=2">Zobrazit fakturu</a></p><a href="https://x.cz">https://x.cz</a></body></html>`;
    expect(htmlToText(html)).toBe("Faktura & spol.\nŘádek 1\nŘádek 2\n\nZobrazit fakturu (https://x.cz/i/abc?a=1&b=2)\nhttps://x.cz");
  });
});

describe("renderNotificationEmail", () => {
  it("renders a single notification under its own title, with the unsubscribe link", () => {
    const out = renderNotificationEmail([item("Faktura 2026-0004 byla zaplacena", { url: "https://x.cz/cs/invoices/1" })], {
      locale: "cs",
      unsubscribeUrl: "https://x.cz/cs/unsubscribe/t",
    });
    expect(out.subject).toBe("Faktura 2026-0004 byla zaplacena");
    expect(out.html).toContain("Otevřít v Billantě");
    expect(out.html).toContain('href="https://x.cz/cs/unsubscribe/t"');
    expect(out.text).toContain("Odhlásit tento typ e-mailů (https://x.cz/cs/unsubscribe/t)");
  });

  it("merges several into one list with a counted subject in the member's language", () => {
    const items = [item("A"), item("B", { kind: "draft_ready" }), item("<C>")];
    expect(renderNotificationEmail(items, { locale: "cs", unsubscribeUrl: null }).subject).toBe("3 nová upozornění v Billantě");
    expect(renderNotificationEmail([...items, item("D"), item("E")], { locale: "cs", unsubscribeUrl: null }).subject).toBe(
      "5 nových upozornění v Billantě",
    );
    const sk = renderNotificationEmail(items, { locale: "sk", unsubscribeUrl: "u" });
    expect(sk.subject).toBe("3 nové upozornenia v Billante");
    expect(sk.html).toContain("Odhlásiť tieto upozornenia");
    expect(sk.html).toContain("&lt;C&gt;");
    expect(renderNotificationEmail(items, { locale: "en", unsubscribeUrl: null }).text).toContain("- B");
  });
});
