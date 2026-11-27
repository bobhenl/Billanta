import { describe, expect, it } from "vitest";
import { openablePage, vaultDocumentView } from "./documents";

const envelope = `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(24)}`;
const owner = { apiKey: undefined, role: "owner", unlocked: false } as const;

describe("openablePage", () => {
  const rows = [
    { id: "a", lockedAt: null },
    { id: "b", lockedAt: new Date("2026-01-01") },
    { id: "c", lockedAt: null },
  ];

  it("leaves locked documents out until the member re-authenticates", () => {
    expect(openablePage(rows, 3, owner)).toMatchObject({ open: [{ id: "a" }, { id: "c" }], skippedLocked: 1, next: null });
    expect(openablePage(rows, 3, { ...owner, unlocked: true }).open.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("pages on the last fetched id, a skipped locked one included", () => {
    expect(openablePage(rows, 2, owner)).toMatchObject({ open: [{ id: "a" }], skippedLocked: 1, next: "b" });
  });
});

describe("vaultDocumentView", () => {
  const invoice = {
    id: "i1",
    documentType: "invoice",
    invoiceNumber: "2026001",
    status: "issued",
    issueDate: new Date("2026-03-01"),
    taxableSupplyDate: null,
    dueDate: null,
    paidAt: null,
    currency: "CZK",
    variableSymbol: "2026001",
    noteAbove: envelope,
    noteBelow: "Děkujeme",
    internalNote: null,
    reverseCharge: false,
    buyerSnapshot: { legalName: "Novák s.r.o. (na dokladu)" },
    createdAt: new Date("2026-03-01"),
  };
  const item = (description: string, sortOrder: number) => ({
    description,
    code: null,
    quantity: "2",
    unit: "hod",
    unitPrice: "1000",
    vatRate: "21",
    discountPercent: "0",
    sortOrder,
    createdAt: new Date("2026-03-01"),
  });

  it("passes the stored texts through as they are, envelopes unopened", () => {
    const view = vaultDocumentView(invoice as never, { legalName: "Novák s.r.o.", ico: "12345678" }, [item("Druhá", 1), item(envelope, 0)] as never);
    expect(view.noteAbove).toBe(envelope);
    expect(view.items.map((i) => i.description)).toEqual([envelope, "Druhá"]);
    expect(view.contactName).toBe("Novák s.r.o. (na dokladu)");
    expect(view.total).toBe(4840);
  });

  it("gives no totals for sealed amounts, so a placeholder never exports as 0", () => {
    const placeholder = { ...item("Práce", 0), quantity: "1", unitPrice: "0", vatRate: null, encAmounts: envelope };
    const view = vaultDocumentView({ ...invoice, encAmounts: envelope } as never, null, [placeholder] as never);
    expect(view).toMatchObject({ total: null, totalVat: null, totalWithoutVat: null, encAmounts: envelope });
    expect(view.items[0]!.encAmounts).toBe(envelope);
  });
});
