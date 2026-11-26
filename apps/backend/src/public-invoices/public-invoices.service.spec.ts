import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { pdfFilename, PublicInvoicesService } from "./public-invoices.service";

const TOKEN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/** A pool whose execute() answers public_invoice_blocked, then get_public_invoice_view. */
function make(view: Record<string, unknown> | undefined, blocked = false) {
  const execute = vi.fn().mockResolvedValueOnce([{ blocked }]).mockResolvedValueOnce(view ? [view] : []);
  const tenantSet: unknown[] = [];
  const tx = vi.fn((_strings: TemplateStringsArray, ...values: unknown[]) => {
    tenantSet.push(values[0]);
    return Promise.resolve([]);
  });
  const sql = { begin: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const generateInvoicePdf = vi.fn().mockResolvedValue(Buffer.from("%PDF-1.7"));
  const service = new PublicInvoicesService({ db: { execute }, sql } as never, undefined, undefined, { generateInvoicePdf } as never);
  return { service, sql, generateInvoicePdf, tenantSet };
}

describe("PublicInvoicesService.generatePdf", () => {
  const issued = { id: "inv-1", tenant_id: "tenant-1", invoice_number: "FV 2026/001", status: "issued" };

  it("renders in a transaction scoped to the invoice's own tenant", async () => {
    const { service, generateInvoicePdf, tenantSet } = make(issued);
    const pdf = await service.generatePdf(TOKEN);
    expect(tenantSet).toEqual(["tenant-1"]);
    expect(generateInvoicePdf).toHaveBeenCalledWith(expect.anything(), "tenant-1", "inv-1");
    expect(pdf.filename).toBe("FV-2026-001.pdf");
    expect(pdf.content.toString()).toBe("%PDF-1.7");
  });

  it("is a 404 for a link that resolves to no token", async () => {
    const { service, sql } = make(issued);
    await expect(service.generatePdf("not-a-token")).rejects.toBeInstanceOf(NotFoundException);
    expect(sql.begin).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown token", undefined, false],
    ["a suspended company", issued, true],
    ["a draft", { ...issued, invoice_number: null, status: "draft" }, false],
    ["an AI draft awaiting review", { ...issued, status: "pending_review" }, false],
  ])("is a 404 for %s", async (_label, view, blocked) => {
    const { service, sql } = make(view, blocked);
    await expect(service.generatePdf(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    expect(sql.begin).not.toHaveBeenCalled();
  });
});

describe("PublicInvoicesService.findByPublicToken totals", () => {
  const header = {
    invoice_number: "FV 2026/007",
    variable_symbol: "2026007",
    issue_date: "2026-11-01",
    due_date: "2026-11-15",
    currency: "CZK",
    status: "issued",
    amount_paid: "0",
    payment_method: "bank_transfer",
    payment_method_label: null,
    payment_instructions: null,
  };
  // 2 × 1000 at 21 % with 10 % off: base 1800, VAT 378, total 2178 (2420 without the discount).
  const lines = [{ description: "Práce", quantity: "2.000", unit_price: "1000.0000", vat_rate: "21.00", sort_order: 0, discount_percent: "10.00" }];
  const qrRow = (reverseCharge: boolean) => ({
    supplier_ico: "12345678",
    supplier_dic: "CZ12345678",
    supplier_vat_payer: true,
    customer_ico: null,
    customer_dic: null,
    taxable_supply_date: "2026-11-01",
    document_type: "invoice",
    reverse_charge: reverseCharge,
    exchange_rate: null,
    order_number: null,
    customer_country: "CZ",
  });

  function view(reverseCharge: boolean) {
    const execute = vi.fn();
    for (const rows of [
      [{ blocked: false }],
      [header],
      lines,
      [{ company_name: "Dodavatel s.r.o.", bank_account_iban: "CZ6508000000192000145399", bank_account_number: null, bank_account_bank_code: null }],
      [],
      [qrRow(reverseCharge)],
      [],
      [{ document_type: "invoice" }],
      [{ demo: false }],
      [],
    ]) {
      execute.mockResolvedValueOnce(rows);
    }
    const service = new PublicInvoicesService({ db: { execute } } as never);
    return service.findByPublicToken(TOKEN);
  }

  it("takes the line discount off, like the PDF", async () => {
    const v = await view(false);
    expect(v.subtotal).toBe(1800);
    expect(v.vatTotal).toBe(378);
    expect(v.total).toBe(2178);
    expect(v.lineItems[0].discountPercent).toBe(10);
    expect(v.qrInvoice).toContain("*AM:2178.00*");
    expect(v.cardPayment).toBe(true);
  });

  it("charges no VAT under reverse charge", async () => {
    const v = await view(true);
    expect(v.vatTotal).toBe(0);
    expect(v.total).toBe(1800);
    expect(v.qrInvoice).toContain("*AM:1800.00*");
  });
});

describe("pdfFilename", () => {
  it("keeps a plain number and makes anything else header-safe", () => {
    expect(pdfFilename("2026001")).toBe("2026001.pdf");
    expect(pdfFilename('Záloha "č." 5/26')).toBe("Zaloha-c.-5-26.pdf");
    expect(pdfFilename("../..")).toBe("invoice.pdf");
  });
});
