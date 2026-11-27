import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { sealedCopies } from "../invoice-templates/invoice-templates.service";
import { assertCardAmount, assertPaymentEnvelope, assertSealedPayable, assertVerdict, sealedPaymentSet } from "./sealed-payments";

// enc:v1:<iv>:<ct>:<wrapIv>:<wrap>; the last two name the document key.
const env = (key: string, ct = "QUJD") => `enc:v1:AAAAAAAAAAAAAAAA:${ct}:${key.repeat(16)}:${key.repeat(64)}`;
const sealedDoc = { encAmounts: env("A"), status: "issued", documentType: "invoice" };

const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return null;
};

describe("assertSealedPayable", () => {
  it("sends a readable document to mark-paid (409 amounts_plain)", () => {
    const e = error(() => assertSealedPayable({ ...sealedDoc, encAmounts: null }, "add"));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toBe("amounts_plain");
  });

  it("adds payments to an issued document only, and removes them from a paid one too", () => {
    expect(() => assertSealedPayable(sealedDoc, "add")).not.toThrow();
    expect(error(() => assertSealedPayable({ ...sealedDoc, status: "paid" }, "add"))?.message).toBe("invoice_not_payable");
    expect(() => assertSealedPayable({ ...sealedDoc, status: "paid" }, "remove")).not.toThrow();
    expect(error(() => assertSealedPayable({ ...sealedDoc, status: "draft" }, "remove"))?.message).toBe("invoice_not_payable");
  });

  it("refuses a quote", () => {
    expect(error(() => assertSealedPayable({ ...sealedDoc, documentType: "quote" }, "add"))).toBeInstanceOf(BadRequestException);
  });
});

describe("assertPaymentEnvelope", () => {
  it("takes an envelope under the document's own key", () => {
    expect(() => assertPaymentEnvelope(sealedDoc, env("A", "WFla"))).not.toThrow();
  });

  it("refuses another document's key (400 document_key_mismatch) and plain text (400 amounts_plaintext)", () => {
    expect(error(() => assertPaymentEnvelope(sealedDoc, env("B")))?.message).toBe("document_key_mismatch");
    expect(error(() => assertPaymentEnvelope(sealedDoc, "1000"))?.message).toBe("amounts_plaintext");
  });

  it("refuses an envelope for a document sealed under the company key only", () => {
    const companyOnly = { encAmounts: "enc:v1:AAAAAAAAAAAAAAAA:QUJD" };
    expect(error(() => assertPaymentEnvelope(companyOnly, "enc:v1:AAAAAAAAAAAAAAAA:WFla"))?.message).toBe("document_key_mismatch");
  });
});

describe("assertVerdict", () => {
  it("fits the verdict to the number of payments left", () => {
    expect(() => assertVerdict("unpaid", 0)).not.toThrow();
    expect(() => assertVerdict("partly_paid", 2)).not.toThrow();
    expect(() => assertVerdict("paid", 1)).not.toThrow();
    expect(error(() => assertVerdict("unpaid", 1))?.message).toBe("payment_state_mismatch");
    expect(error(() => assertVerdict("paid", 0))?.message).toBe("payment_state_mismatch");
    expect(error(() => assertVerdict("partly_paid", 0))?.message).toBe("payment_state_mismatch");
  });
});

describe("sealedPaymentSet", () => {
  const day = new Date("2026-11-20T00:00:00Z");
  const earlier = new Date("2026-11-01T00:00:00Z");

  it("marks paid with the payment's date and drops an allowed card amount", () => {
    expect(sealedPaymentSet("paid", { status: "issued", paidAt: null }, day)).toEqual({ status: "paid", paidAt: day, sealedPaymentState: null, cardAmount: null });
  });

  it("keeps the first paid date of a document that stays paid", () => {
    expect(sealedPaymentSet("paid", { status: "paid", paidAt: earlier }, day).paidAt).toBe(earlier);
  });

  it("puts a partly paid document back to issued with the state, and an unpaid one without it", () => {
    expect(sealedPaymentSet("partly_paid", { status: "paid", paidAt: earlier }, day)).toEqual({
      status: "issued",
      paidAt: null,
      sealedPaymentState: "partly_paid",
      cardAmount: null,
    });
    expect(sealedPaymentSet("unpaid", { status: "issued", paidAt: null }, day).sealedPaymentState).toBeNull();
  });
});

describe("assertCardAmount", () => {
  it("allows a whole-cent amount on an issued invoice or proforma, and switching it off", () => {
    expect(() => assertCardAmount(sealedDoc, 1210.5)).not.toThrow();
    // Float noise from the browser sum is not a fraction of a cent.
    expect(() => assertCardAmount(sealedDoc, 0.1 + 0.2)).not.toThrow();
    expect(() => assertCardAmount({ ...sealedDoc, documentType: "proforma" }, 0.3)).not.toThrow();
    expect(() => assertCardAmount({ ...sealedDoc, status: "paid" }, null)).not.toThrow();
  });

  it("refuses a readable document, a paid one, a credit note and fractions of a cent", () => {
    expect(error(() => assertCardAmount({ ...sealedDoc, encAmounts: null }, 100))?.message).toBe("amounts_plain");
    expect(error(() => assertCardAmount({ ...sealedDoc, status: "paid" }, 100))?.message).toBe("invoice_not_payable");
    expect(error(() => assertCardAmount({ ...sealedDoc, documentType: "credit_note" }, 100))?.message).toBe("invoice_not_payable");
    expect(error(() => assertCardAmount(sealedDoc, 10.005))).toBeInstanceOf(BadRequestException);
    expect(error(() => assertCardAmount(sealedDoc, 0))).toBeInstanceOf(BadRequestException);
  });
});

describe("sealedCopies (bulk invoicing from a sealed template)", () => {
  const c1 = "11111111-1111-4111-8111-111111111111";
  const c2 = "22222222-2222-4222-8222-222222222222";
  const copy = (contact: string, key: string) => ({
    contact_id: contact,
    enc_amounts: env(key),
    note_above: env(key, "Tk9URQ"),
    note_below: null,
    line_items: [{ description: env(key, "REVTQw"), enc_amounts: env(key, "SVRFTQ") }],
  });

  it("maps one copy per customer, each under its own key", () => {
    const map = sealedCopies({ issue: false, sealed: [copy(c1, "A"), copy(c2, "B")] }, [c1, c2], 1);
    expect(map.get(c2)?.enc_amounts).toBe(env("B"));
  });

  it("refuses without copies (409 amounts_sealed) and when asked to issue (drafts only)", () => {
    const e = error(() => sealedCopies({ issue: false }, [c1], 1));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toBe("amounts_sealed");
    expect(error(() => sealedCopies({ issue: true, sealed: [copy(c1, "A")] }, [c1], 1))?.message).toBe("sealed_bulk_drafts_only");
  });

  it("refuses two customers sharing one document key", () => {
    expect(error(() => sealedCopies({ issue: false, sealed: [copy(c1, "A"), copy(c2, "A")] }, [c1, c2], 1))?.message).toBe("rekey_one_document_key");
  });

  it("refuses a copy mixing keys, a missing customer or a missing item", () => {
    const mixed = { ...copy(c1, "A"), note_above: env("B") };
    expect(error(() => sealedCopies({ issue: false, sealed: [mixed] }, [c1], 1))?.message).toBe("rekey_one_document_key");
    expect(error(() => sealedCopies({ issue: false, sealed: [copy(c1, "A")] }, [c1, c2], 1))?.message).toBe("sealed_bulk_mismatch");
    expect(error(() => sealedCopies({ issue: false, sealed: [copy(c1, "A")] }, [c1], 2))?.message).toBe("sealed_bulk_mismatch");
  });
});
