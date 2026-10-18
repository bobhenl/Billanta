import { describe, expect, it } from "vitest";
import { EXPORT_DISCLAIMER, withXmlDisclaimer } from "./disclaimer";

describe("withXmlDisclaimer", () => {
  it("puts the comment between the prolog and the root element", () => {
    expect(withXmlDisclaimer('<?xml version="1.0" encoding="UTF-8"?>\n<a/>', "x")).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<!-- x -->\n<a/>');
  });

  it("leaves the body untouched", () => {
    const body = '<Pisemnost nazevSW="EPO MF ČR">\n  <Veta1 a="1" />\n</Pisemnost>\n';
    expect(withXmlDisclaimer(`<?xml version="1.0"?>\r\n${body}`).endsWith(`-->\n${body}`)).toBe(true);
  });

  it("never writes a double hyphen or a trailing hyphen into the comment", () => {
    const out = withXmlDisclaimer("<?xml version=\"1.0\"?>\n<a/>", "a -- b --- c-");
    expect(out).toContain("<!-- a – b – c– -->");
  });

  it("puts the comment first when there is no prolog", () => {
    expect(withXmlDisclaimer("<a/>", "x")).toBe("<!-- x -->\n<a/>");
  });

  it("says the file is informative, without warranty, and needs checking", () => {
    expect(EXPORT_DISCLAIMER).toMatch(/informativní/);
    expect(EXPORT_DISCLAIMER).toMatch(/bez záruky/);
    expect(EXPORT_DISCLAIMER).toMatch(/daňového poradce/);
    expect(EXPORT_DISCLAIMER).not.toContain("--");
  });
});
