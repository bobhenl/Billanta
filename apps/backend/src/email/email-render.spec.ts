import { describe, expect, it } from "vitest";
import { appUrlOf, emailLocaleOf, htmlToText, renderNotificationEmail } from "./email-render";

describe("emailLocaleOf", () => {
  it("keeps cs, sk and en, reads other app locales as English and a missing one as Czech", () => {
    expect(emailLocaleOf("cs")).toBe("cs");
    expect(emailLocaleOf("sk")).toBe("sk");
    expect(emailLocaleOf("en")).toBe("en");
    expect(emailLocaleOf("SK-sk")).toBe("sk");
    expect(emailLocaleOf("de")).toBe("en");
    expect(emailLocaleOf("pl")).toBe("en");
    expect(emailLocaleOf(null)).toBe("cs");
    expect(emailLocaleOf(undefined)).toBe("cs");
    expect(emailLocaleOf(" ")).toBe("cs");
  });
});

describe("appUrlOf", () => {
  it("prefixes app links with the e-mail's locale once", () => {
    expect(appUrlOf("https://x.cz/", "sk", "/invite/t")).toBe("https://x.cz/sk/invite/t");
    expect(appUrlOf("https://x.cz", "en", "invoices/1")).toBe("https://x.cz/en/invoices/1");
    expect(appUrlOf("https://x.cz", "en", "/cs/invoices/1")).toBe("https://x.cz/cs/invoices/1");
    expect(appUrlOf("https://x.cz", "sk", "/cs?x=1")).toBe("https://x.cz/cs?x=1");
    // "/csv-export" only starts with the letters of a locale.
    expect(appUrlOf("https://x.cz", "sk", "/csv-export")).toBe("https://x.cz/sk/csv-export");
  });
});

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
