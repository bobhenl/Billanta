import { describe, expect, it } from "vitest";
import { renderInvitationEmail } from "./invitation-email";

const base = { companyName: "Tom Vejmelka", role: "accountant", acceptUrl: "https://x.cz/cs/invite/abc" } as const;

describe("renderInvitationEmail", () => {
  it("never puts the company after a preposition in Czech", () => {
    const out = renderInvitationEmail({ ...base, locale: "cs" });
    expect(out.subject).toBe("Tom Vejmelka vás zve do týmu v Billantě");
    expect(out.html).toContain("Pozvánka do týmu v Billantě");
    expect(out.html).toContain("<strong>Tom Vejmelka</strong> vás zve do svého týmu v aplikaci Billanta s rolí <strong>Účetní</strong>");
    expect(out.html).not.toContain("Pozvánka do Tom");
    expect(out.html).toContain('<html lang="cs">');
  });

  it("is written in the company's language", () => {
    const sk = renderInvitationEmail({ ...base, locale: "sk", acceptUrl: "https://x.cz/sk/invite/abc" });
    expect(sk.subject).toBe("Tom Vejmelka vás pozýva do tímu v Billante");
    expect(sk.html).toContain('<html lang="sk">');
    expect(sk.html).toContain("Účtovník");
    expect(sk.html).toContain('href="https://x.cz/sk/invite/abc"');
    const en = renderInvitationEmail({ ...base, locale: "en" });
    expect(en.subject).toBe("Tom Vejmelka invited you to their team on Billanta");
    expect(en.html).toContain('<html lang="en">');
    expect(en.text).toContain("Accept invitation (https://x.cz/cs/invite/abc)");
  });

  it("lists the access per area, with the overrides applied", () => {
    const out = renderInvitationEmail({ ...base, locale: "cs", permissions: { bank: "none", reports: "read" } });
    expect(out.html).toContain("<li>Faktury – úpravy</li>");
    expect(out.html).toContain("<li>Banka – bez přístupu</li>");
    expect(out.html).toContain("<li>Exporty – jen čtení</li>");
    expect(out.html).not.toContain("spravovat tým");
    expect(renderInvitationEmail({ ...base, role: "admin", locale: "cs" }).html).toContain("Můžete také spravovat tým a nastavení firmy.");
  });

  it("escapes the company name", () => {
    const out = renderInvitationEmail({ ...base, companyName: "<b>Evil</b>", locale: "en" });
    expect(out.html).not.toContain("<b>Evil</b>");
    expect(out.html).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });
});
