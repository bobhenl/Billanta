import { describe, expect, it } from "vitest";
import { classroomBlockFor } from "./classroom-policy";

describe("classroomBlockFor", () => {
  it("lets students work with documents", () => {
    expect(classroomBlockFor("POST", "v1/invoices", false)).toBeNull();
    expect(classroomBlockFor("GET", "v1/invoices/abc/pdf", false)).toBeNull();
    expect(classroomBlockFor("POST", "v1/contacts", false)).toBeNull();
  });

  it("closes the demo extras and the client portal", () => {
    expect(classroomBlockFor("POST", "v1/demo/transfer", false)).toBe("classroom_disabled");
    expect(classroomBlockFor("GET", "v1/demo/roles", false)).toBe("classroom_disabled");
    expect(classroomBlockFor("POST", "v1/contacts/abc/portal", false)).toBe("classroom_disabled");
  });

  it("keeps the exports for the VAT lessons", () => {
    expect(classroomBlockFor("GET", "v1/exports/dphkh1.xml", false)).toBeNull();
  });

  it("is read-only after the class ended", () => {
    expect(classroomBlockFor("GET", "v1/invoices", true)).toBeNull();
    expect(classroomBlockFor("POST", "v1/invoices", true)).toBe("classroom_ended");
    expect(classroomBlockFor("PATCH", "v1/tenants/me", true)).toBe("classroom_ended");
  });
});
