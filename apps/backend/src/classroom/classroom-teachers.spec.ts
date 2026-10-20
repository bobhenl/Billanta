import { describe, expect, it } from "vitest";
import { applicationCapDomain, schoolDomainOnApproval } from "./classroom-teachers.service";

describe("schoolDomainOnApproval", () => {
  const school = { emailDomain: null };

  it("takes the domain staff confirmed", () => {
    expect(schoolDomainOnApproval(" Skola.CZ ", school)).toBe("skola.cz");
  });

  it("falls back to the stored domain only", () => {
    expect(schoolDomainOnApproval(undefined, { emailDomain: "oa.sk" })).toBe("oa.sk");
    // The applicant's website is not a source: the first applicant typed it.
    expect(schoolDomainOnApproval(undefined, school)).toBeNull();
  });

  it("never stores a freemail or a non-domain", () => {
    expect(schoolDomainOnApproval("gmail.com", school)).toBeNull();
    expect(schoolDomainOnApproval("gmx.de", school)).toBeNull();
    expect(schoolDomainOnApproval("https://skola.cz/x", school)).toBeNull();
  });
});

describe("applicationCapDomain", () => {
  it("counts proven addresses on a domain of their own", () => {
    expect(applicationCapDomain("novak@OA-Praha.cz", true)).toBe("oa-praha.cz");
  });

  it("leaves free mailboxes and unproven addresses alone", () => {
    expect(applicationCapDomain("novak@gmail.com", true)).toBeNull();
    expect(applicationCapDomain("novak@yahoo.co.uk", true)).toBeNull();
    expect(applicationCapDomain("novak@oa-praha.cz", false)).toBeNull();
    expect(applicationCapDomain("nobody", true)).toBeNull();
  });
});
