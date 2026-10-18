import { describe, expect, it } from "vitest";
import { domainFromUrl, emailDomain, isFreemail, onSchoolDomain } from "./email-domain";

describe("email domains", () => {
  it("takes the domain of an address", () => {
    expect(emailDomain("Jana.Novakova@OA-Praha.cz")).toBe("oa-praha.cz");
    expect(emailDomain("nobody")).toBeNull();
    expect(emailDomain("a@localhost")).toBeNull();
  });

  it("knows free mailboxes", () => {
    expect(isFreemail("seznam.cz")).toBe(true);
    expect(isFreemail("azet.sk")).toBe(true);
    expect(isFreemail("oa-praha.cz")).toBe(false);
  });

  it("derives the school domain from its web address", () => {
    expect(domainFromUrl("https://www.oa-praha.cz/kontakt")).toBe("oa-praha.cz");
    expect(domainFromUrl("zsjihlava.cz")).toBe("zsjihlava.cz");
    expect(domainFromUrl("https://sites.google.com/view/skola")).toBe("sites.google.com");
    expect(domainFromUrl("http://www.seznam.cz")).toBeNull();
    expect(domainFromUrl(null)).toBeNull();
  });

  it("matches addresses on the school domain and its subdomains", () => {
    expect(onSchoolDomain("novak@oa-praha.cz", "oa-praha.cz")).toBe(true);
    expect(onSchoolDomain("novak@ucitel.oa-praha.cz", "oa-praha.cz")).toBe(true);
    expect(onSchoolDomain("novak@fakeoa-praha.cz", "oa-praha.cz")).toBe(false);
    expect(onSchoolDomain("novak@gmail.com", "gmail.com")).toBe(false);
    expect(onSchoolDomain("novak@oa-praha.cz", null)).toBe(false);
  });
});
