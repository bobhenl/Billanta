import { describe, expect, it, vi } from "vitest";
import { InvoiceTemplatesService } from "../invoice-templates/invoice-templates.service";
import { InvoicesService, assertSealedCreditNote, sealedInputAmounts } from "../invoices/invoices.service";
import { convertInvoiceSchema } from "../invoices/dto/create-invoice.dto";

// Credit notes, proforma deposits and templates of documents with sealed amounts.

const wrap = `${"W".repeat(16)}:${"K".repeat(64)}`;
const otherWrap = `${"V".repeat(16)}:${"K".repeat(64)}`;
const env = (ct: string, w: string | null = wrap) => `enc:v1:AAAAAAAAAAAAAAAA:${ct.repeat(24)}${w ? `:${w}` : ""}`;

const sourceInvoice = (encAmounts: string | null) => ({
  id: "inv",
  tenantId: "t1",
  documentType: "invoice",
  status: "issued",
  invoiceNumber: "2026001",
  contactId: "c1",
  currency: "CZK",
  reverseCharge: false,
  encAmounts,
});

const lineItems = (encAmounts: (string | null)[]) =>
  encAmounts.map((e, i) => ({ description: `d${i}`, quantity: "1.000", unitPrice: "0.0000", vatRate: null, discountPercent: "0", unit: null, code: null, encAmounts: e }));

describe("assertSealedCreditNote", () => {
  const source = sourceInvoice(env("A"));
  const items = lineItems([env("B"), env("C")]);

  it("takes envelopes sealed under the invoice's document key, one per item", () => {
    expect(() => assertSealedCreditNote(source, items, { encAmounts: env("X"), items: [env("Y"), env("Z")] })).not.toThrow();
  });

  it("refuses another item count", () => {
    expect(() => assertSealedCreditNote(source, items, { encAmounts: env("X"), items: [env("Y")] })).toThrow("amounts_mismatch");
  });

  it("refuses an envelope under another document key", () => {
    expect(() => assertSealedCreditNote(source, items, { encAmounts: env("X", otherWrap), items: [env("Y"), env("Z")] })).toThrow(
      "document_key_mismatch",
    );
    expect(() => assertSealedCreditNote(source, items, { encAmounts: env("X"), items: [env("Y"), env("Z", otherWrap)] })).toThrow(
      "document_key_mismatch",
    );
  });

  it("refuses an envelope under the company key (no document key)", () => {
    expect(() => assertSealedCreditNote(source, items, { encAmounts: env("X", null), items: [env("Y"), env("Z")] })).toThrow(
      "document_key_mismatch",
    );
  });

  it("refuses when the invoice itself has no document key", () => {
    const companyKeyed = sourceInvoice(env("A", null));
    expect(() =>
      assertSealedCreditNote(companyKeyed, lineItems([env("B", null)]), { encAmounts: env("X", null), items: [env("Y", null)] }),
    ).toThrow("document_key_mismatch");
  });
});

describe("convert to a credit note", () => {
  function setup(source: ReturnType<typeof sourceInvoice>, items: ReturnType<typeof lineItems>) {
    const inserted: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => items,
            limit: async () => [{ defaultDueDays: 14 }],
          }),
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          inserted.push(v);
          return { returning: async () => [{ id: "draft", tenantId: "t1", documentType: "credit_note", invoiceNumber: null }] };
        },
      }),
    };
    const service = new InvoicesService({} as never, {} as never) as unknown as {
      requireInvoice: unknown;
      log: unknown;
      convert: InvoicesService["convert"];
    };
    service.requireInvoice = vi.fn(async () => source);
    service.log = vi.fn(async () => undefined);
    const convert = (to: "invoice" | "credit_note" | "proforma", sealed?: { encAmounts: string; items: string[] }) =>
      service.convert(db as never, "t1", "inv", to, sealed);
    return { convert, inserted };
  }

  it("still refuses a sealed invoice without the browser's envelopes", async () => {
    const { convert, inserted } = setup(sourceInvoice(env("A")), lineItems([env("B")]));
    await expect(convert("credit_note")).rejects.toMatchObject({ status: 409, message: "amounts_sealed" });
    expect(inserted).toHaveLength(0);
  });

  it("stores the browser's envelopes and keeps the placeholder quantity", async () => {
    const { convert, inserted } = setup(sourceInvoice(env("A")), lineItems([env("B"), env("C")]));
    await convert("credit_note", { encAmounts: env("X"), items: [env("Y"), env("Z")] });
    expect(inserted[0]).toMatchObject({ documentType: "credit_note", encAmounts: env("X"), relatedInvoiceId: "inv" });
    expect(inserted[1]).toEqual([
      expect.objectContaining({ quantity: "1.000", encAmounts: env("Y"), sortOrder: 0 }),
      expect.objectContaining({ quantity: "1.000", encAmounts: env("Z"), sortOrder: 1 }),
    ]);
  });

  it("checks the envelopes before anything is written", async () => {
    const { convert, inserted } = setup(sourceInvoice(env("A")), lineItems([env("B")]));
    await expect(convert("credit_note", { encAmounts: env("X", otherWrap), items: [env("Y")] })).rejects.toThrow("document_key_mismatch");
    expect(inserted).toHaveLength(0);
  });

  it("refuses envelopes for a plain invoice", async () => {
    const { convert, inserted } = setup(sourceInvoice(null), lineItems([null]));
    await expect(convert("credit_note", { encAmounts: env("X"), items: [env("Y")] })).rejects.toThrow("amounts_not_sealed");
    expect(inserted).toHaveLength(0);
  });

  it("refuses envelopes for any other conversion", async () => {
    const source = { ...sourceInvoice(env("A")), documentType: "quote" };
    const { convert, inserted } = setup(source, lineItems([env("B")]));
    await expect(convert("invoice", { encAmounts: env("X"), items: [env("Y")] })).rejects.toThrow("amounts_not_sealed");
    expect(inserted).toHaveLength(0);
  });

  it("negates a plain invoice's quantities on the server as before", async () => {
    const items = lineItems([null]).map((i) => ({ ...i, quantity: "3.000", unitPrice: "100" }));
    const { convert, inserted } = setup(sourceInvoice(null), items);
    await convert("credit_note");
    expect(inserted[1]).toEqual([expect.objectContaining({ quantity: "-3", encAmounts: null })]);
  });
});

describe("sealedInputAmounts and a paid proforma", () => {
  const invoice = { ...sourceInvoice(env("A")), status: "paid" as const };
  const proforma = { documentType: "proforma", status: "paid" };

  it("marks the final invoice of a paid proforma", () => {
    expect(sealedInputAmounts(invoice as never, [{ encAmounts: env("B") }], proforma)?.depositIsTotal).toBe(true);
  });

  it("leaves an unpaid invoice, a credit note's source and a plain document alone", () => {
    expect(sealedInputAmounts({ ...invoice, status: "issued" } as never, [], proforma)?.depositIsTotal).toBe(false);
    expect(sealedInputAmounts(invoice as never, [], { documentType: "quote", status: "paid" })?.depositIsTotal).toBe(false);
    expect(sealedInputAmounts(invoice as never, [], null)?.depositIsTotal).toBe(false);
    expect(sealedInputAmounts({ ...invoice, encAmounts: null } as never, [], proforma)).toBeNull();
  });
});

describe("templates of sealed invoices", () => {
  function templatesDb(invoice: unknown, items: unknown[], inserted: unknown[]) {
    let call = 0;
    return {
      select: () => ({
        from: () => ({
          where: () => {
            call += 1;
            return call === 1 ? Promise.resolve([invoice]) : { orderBy: async () => items };
          },
        }),
      }),
      insert: () => ({
        values: (v: unknown) => {
          inserted.push(v);
          return { returning: async () => [v] };
        },
      }),
    };
  }
  const invoiceRow = (encAmounts: string | null) => ({ ...sourceInvoice(encAmounts), issueDate: null, dueDate: null });

  it("keeps the item envelopes, so the template carries the real prices", async () => {
    const inserted: { lineItems: unknown[] }[] = [];
    const service = new InvoiceTemplatesService({} as never);
    await service.createFromInvoice(templatesDb(invoiceRow(env("A")), lineItems([env("B")]), inserted) as never, "t1", "inv");
    expect(inserted[0].lineItems).toEqual([expect.objectContaining({ unitPrice: 0, encAmounts: env("B") })]);
  });

  it("copies no envelope from a plain invoice", async () => {
    const inserted: { lineItems: Record<string, unknown>[] }[] = [];
    const service = new InvoiceTemplatesService({} as never);
    await service.createFromInvoice(templatesDb(invoiceRow(null), lineItems([env("B")]), inserted) as never, "t1", "inv");
    expect(inserted[0].lineItems[0]).not.toHaveProperty("encAmounts");
  });

  it("refuses bulk invoicing from a sealed template before touching any contact", async () => {
    const service = new InvoiceTemplatesService({} as never);
    const select = vi.fn();
    (service as unknown as { findOne: unknown }).findOne = vi.fn(async () => ({
      id: "tpl",
      lineItems: [{ description: "x", quantity: 1, unitPrice: 0, vatRate: null, discountPercent: 0, encAmounts: env("B") }],
    }));
    await expect(service.bulk({ select } as never, "t1", "u1", "tpl", { contact_ids: ["c1"] } as never)).rejects.toMatchObject({
      status: 409,
      message: "amounts_sealed",
    });
    expect(select).not.toHaveBeenCalled();
  });
});

describe("convert body", () => {
  it("takes both envelope fields or neither", () => {
    expect(convertInvoiceSchema.safeParse({ to: "credit_note" }).success).toBe(true);
    expect(convertInvoiceSchema.safeParse({ to: "credit_note", enc_amounts: env("X"), item_enc_amounts: [env("Y")] }).success).toBe(true);
    expect(convertInvoiceSchema.safeParse({ to: "credit_note", enc_amounts: env("X") }).success).toBe(false);
    expect(convertInvoiceSchema.safeParse({ to: "credit_note", item_enc_amounts: [env("Y")] }).success).toBe(false);
    expect(convertInvoiceSchema.safeParse({ to: "credit_note", enc_amounts: "1000", item_enc_amounts: ["5"] }).success).toBe(false);
  });
});
