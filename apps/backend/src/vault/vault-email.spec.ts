import { describe, expect, it } from "vitest";
import { documentIsSealed, looksLikePdf, sealedSendPlan } from "./vault-email";

const SEALED = "enc:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBB";

describe("documentIsSealed", () => {
  it("is false for plain texts", () => {
    expect(documentIsSealed({ noteAbove: "Hi", noteBelow: null }, [{ description: "Work" }])).toBe(false);
  });

  it("notices a sealed note or a sealed item", () => {
    expect(documentIsSealed({ noteAbove: SEALED, noteBelow: null }, [{ description: "Work" }])).toBe(true);
    expect(documentIsSealed({ noteAbove: null, noteBelow: SEALED }, [])).toBe(true);
    expect(documentIsSealed({ noteAbove: null, noteBelow: null }, [{ description: "Work" }, { description: SEALED }])).toBe(true);
  });
});

describe("sealedSendPlan", () => {
  it("sends now and queues the PDF by default", () => {
    expect(sealedSendPlan(undefined, true)).toEqual({ sendNow: true, queue: "invoice_pdf" });
    expect(sealedSendPlan("link_now", true)).toEqual({ sendNow: true, queue: "invoice_pdf" });
    expect(sealedSendPlan("something-else", true)).toEqual({ sendNow: true, queue: "invoice_pdf" });
  });

  it("holds the whole e-mail in wait mode", () => {
    expect(sealedSendPlan("wait", true)).toEqual({ sendNow: false, queue: "invoice" });
  });

  it("queues nothing in link-only mode or when the company sends no PDF anyway", () => {
    expect(sealedSendPlan("link_only", true)).toEqual({ sendNow: true, queue: null });
    expect(sealedSendPlan("wait", false)).toEqual({ sendNow: true, queue: null });
    expect(sealedSendPlan("link_now", false)).toEqual({ sendNow: true, queue: null });
  });
});

describe("looksLikePdf", () => {
  it("accepts a PDF header and refuses anything else", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\n%..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("<html>not a pdf</html>"))).toBe(false);
    expect(looksLikePdf(Buffer.from("%PDF-"))).toBe(false);
  });
});
