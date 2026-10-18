import { describe, expect, it } from "vitest";
import { schoolDomainOnApproval } from "./classroom-teachers.service";

describe("schoolDomainOnApproval", () => {
  const school = { emailDomain: null, webUrl: "https://www.gymnazium-brno.cz/kontakt" };

  it("takes the domain staff confirmed", () => {
    expect(schoolDomainOnApproval(" Skola.CZ ", school)).toBe("skola.cz");
  });

  it("falls back to the stored domain, then to the website", () => {
    expect(schoolDomainOnApproval(undefined, { ...school, emailDomain: "oa.sk" })).toBe("oa.sk");
    expect(schoolDomainOnApproval(undefined, school)).toBe("gymnazium-brno.cz");
  });

  it("never stores a freemail or a non-domain", () => {
    expect(schoolDomainOnApproval("gmail.com", school)).toBeNull();
    expect(schoolDomainOnApproval("https://skola.cz/x", school)).toBeNull();
    expect(schoolDomainOnApproval(undefined, { emailDomain: null, webUrl: null })).toBeNull();
  });
});
