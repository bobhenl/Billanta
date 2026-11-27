import { describe, expect, it } from "vitest";
import { lineItemsFromSnapshot } from "./snapshot-items";

const ENVELOPE = "enc:v1:AAAAAAAAAAAAAAAA:c2VhbGVkIHRleHQgaGVyZQ==";

describe("lineItemsFromSnapshot", () => {
  it("copies an encrypted description as the same envelope", () => {
    const [item] = lineItemsFromSnapshot([{ description: ENVELOPE, quantity: 2, unitPrice: 150.5, vatRate: 21 }], "t-1", "i-1");
    expect(item).toEqual({ tenantId: "t-1", invoiceId: "i-1", description: ENVELOPE, quantity: "2", unitPrice: "150.5", vatRate: "21", sortOrder: 0 });
  });

  it("keeps the order and plain texts, with no VAT rate when none was stored", () => {
    const items = lineItemsFromSnapshot(
      [
        { description: "Hosting", quantity: 1, unitPrice: 100 },
        { description: ENVELOPE, quantity: 3, unitPrice: 10, vatRate: null },
      ],
      "t-1",
      "i-1",
    );
    expect(items.map((i) => [i.description, i.sortOrder, i.vatRate])).toEqual([
      ["Hosting", 0, null],
      [ENVELOPE, 1, null],
    ]);
  });

  it("makes no items from an empty snapshot", () => {
    expect(lineItemsFromSnapshot(null, "t-1", "i-1")).toEqual([]);
  });
});
