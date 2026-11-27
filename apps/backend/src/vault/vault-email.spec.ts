import { describe, expect, it } from "vitest";
import { documentIsSealed, looksLikePdf, sealedSendPlan, withOpenedTexts } from "./vault-email";

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

describe("withOpenedTexts", () => {
  const invoice = { id: "inv", noteAbove: SEALED, noteBelow: "Plain footer" };
  const items = [
    { id: "a", description: SEALED },
    { id: "b", description: "Plain item" },
  ];

  it("replaces only the envelopes with the opened texts", () => {
    const out = withOpenedTexts(invoice, items, {
      noteAbove: "Secret note",
      noteBelow: "Rewritten footer",
      items: [
        { id: "a", description: "Secret item" },
        { id: "b", description: "Rewritten item" },
      ],
    });
    expect(out.invoice.noteAbove).toBe("Secret note");
    // A plain text is what the server stored, whatever the browser sends.
    expect(out.invoice.noteBelow).toBe("Plain footer");
    expect(out.items.map((i) => i.description)).toEqual(["Secret item", "Plain item"]);
  });

  it("refuses to print when an envelope has no text", () => {
    expect(() => withOpenedTexts(invoice, items, { noteAbove: "Secret note" })).toThrow("texts_missing");
    expect(() => withOpenedTexts(invoice, items, { items: [{ id: "a", description: "x" }] })).toThrow("texts_missing");
  });

  it("does not touch the stored rows", () => {
    withOpenedTexts(invoice, items, { noteAbove: "Secret note", items: [{ id: "a", description: "Secret item" }] });
    expect(invoice.noteAbove).toBe(SEALED);
    expect(items[0].description).toBe(SEALED);
  });
});

describe("looksLikePdf", () => {
  it("accepts a PDF header and refuses anything else", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\n%..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("<html>not a pdf</html>"))).toBe(false);
    expect(looksLikePdf(Buffer.from("%PDF-"))).toBe(false);
  });
});
