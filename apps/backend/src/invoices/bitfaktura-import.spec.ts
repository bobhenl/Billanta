import { describe, expect, it } from "vitest";
import { bitfakturaBaseUrl, BitfakturaError, fetchBitfakturaInvoices, mapBitfakturaInvoices, type BitfakturaInvoice } from "./bitfaktura-import";

const invoice = (over: Partial<BitfakturaInvoice> = {}): BitfakturaInvoice => ({
  id: 1,
  number: "3/10/2026",
  kind: "vat",
  status: "paid",
  issue_date: "2026-10-07",
  sell_date: "2026-09-30",
  payment_to: "2026-10-21",
  paid_date: "2026-10-09",
  currency: "USD",
  exchange_rate: "20.861",
  payment_type: "paypal",
  lang: "cz/en",
  reverse_charge: false,
  description: "Thanks!",
  buyer_name: "Acme Ltd",
  buyer_tax_no: "",
  buyer_email: "billing@acme.example",
  buyer_street: "1 Main St",
  buyer_city: "Austin",
  buyer_post_code: "78701",
  buyer_country: "US",
  positions: [{ name: "Software services", quantity: "2.0", quantity_unit: "", price_net: "137.5", price_gross: "137.5", tax: "disabled" }],
  ...over,
});

describe("bitfakturaBaseUrl", () => {
  it("accepts an account name, a host or a pasted URL on the platform's domains", () => {
    expect(bitfakturaBaseUrl("firma")).toBe("https://firma.bitfaktura.cz");
    expect(bitfakturaBaseUrl(" Firma.BitFaktura.cz ")).toBe("https://firma.bitfaktura.cz");
    expect(bitfakturaBaseUrl("https://firma.bitfaktura.cz/invoices?x=1")).toBe("https://firma.bitfaktura.cz");
    expect(bitfakturaBaseUrl("firma.fakturownia.pl")).toBe("https://firma.fakturownia.pl");
  });

  it("refuses any other host, so the backend cannot be pointed elsewhere", () => {
    for (const bad of ["evil.com", "x.bitfaktura.cz.evil.com", "a.b.bitfaktura.cz", "user@firma.bitfaktura.cz", "app.bitfaktura.cz", "bitfaktura.cz", "127.0.0.1", "-x.bitfaktura.cz", ""]) {
      expect(bitfakturaBaseUrl(bad), bad).toBeNull();
    }
  });
});

describe("mapBitfakturaInvoices", () => {
  it("keeps number, dates, payment, language and the recorded ČNB rate", () => {
    const { invoices, skipped } = mapBitfakturaInvoices([invoice()]);
    expect(skipped).toEqual([]);
    expect(invoices[0]).toMatchObject({
      invoiceNumber: "3/10/2026",
      documentType: "invoice",
      currency: "USD",
      status: "paid",
      exchangeRate: 20.861,
      paymentMethod: "other",
      paymentMethodLabel: "PayPal",
      language: "cs",
      reverseCharge: false,
      note: "Thanks!",
      customer: { legalName: "Acme Ltd", ico: null, dic: null, addressCountry: "US", email: "billing@acme.example" },
      lines: [{ description: "Software services", quantity: 2, unitPrice: 137.5, vatRate: 0, unit: null }],
    });
    expect(invoices[0]!.issueDate.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    expect(invoices[0]!.taxableSupplyDate!.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(invoices[0]!.dueDate!.toISOString()).toBe("2026-10-21T00:00:00.000Z");
    expect(invoices[0]!.paidAt!.toISOString()).toBe("2026-10-09T00:00:00.000Z");
  });

  it("maps reverse charge, VAT IDs vs IČO and unknown payment types", () => {
    const { invoices } = mapBitfakturaInvoices([
      invoice({ number: "a", reverse_charge: true, buyer_tax_no: "IT 01234567891", payment_type: "Wise", positions: [{ name: "x", price_net: "50", tax: "0" }] }),
      invoice({ number: "b", buyer_tax_no: "27082440", currency: "CZK", exchange_rate: "1.0", payment_type: "transfer", lang: "sk" }),
    ]);
    expect(invoices[0]).toMatchObject({ reverseCharge: true, paymentMethod: "other", paymentMethodLabel: "Wise", customer: { dic: "IT01234567891", ico: null } });
    expect(invoices[1]).toMatchObject({ paymentMethod: "bank_transfer", paymentMethodLabel: null, exchangeRate: null, language: "sk", customer: { ico: "27082440", dic: null } });
  });

  it("drops a placeholder 1.0 rate on a foreign invoice so the import looks it up", () => {
    expect(mapBitfakturaInvoices([invoice({ exchange_rate: "1.0" })]).invoices[0]!.exchangeRate).toBeNull();
  });

  it("derives the net unit price from gross when only gross is sent", () => {
    const line = mapBitfakturaInvoices([invoice({ positions: [{ name: "x", price_gross: "121", tax: "21" }] })]).invoices[0]!.lines[0]!;
    expect(line).toMatchObject({ unitPrice: 100, vatRate: 21, quantity: 1 });
  });

  it("maps document kinds and statuses, and skips what it cannot represent", () => {
    const { invoices, skipped } = mapBitfakturaInvoices([
      invoice({ number: "p", kind: "proforma", status: "issued" }),
      invoice({ number: "c", kind: "correction", status: "sent", cancelled: true }),
      invoice({ number: "e", kind: "estimate" }),
      invoice({ number: "d", positions: [{ name: "x", price_net: "10", tax: "21", discount_percent: "10" }] }),
      invoice({ number: "n", buyer_name: "", buyer_first_name: null, buyer_last_name: null }),
      invoice({ number: "p" }),
    ]);
    expect(invoices.map((i) => [i.invoiceNumber, i.documentType, i.status, i.paidAt])).toEqual([
      ["p", "proforma", "issued", null],
      ["c", "credit_note", "cancelled", null],
    ]);
    expect(skipped).toEqual([
      { line: 3, number: "e", reason: "unsupported_kind" },
      { line: 4, number: "d", reason: "unsupported_discount" },
      { line: 5, number: "n", reason: "missing_customer" },
      { line: 6, number: "p", reason: "duplicate_in_file" },
    ]);
  });
});

describe("fetchBitfakturaInvoices", () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => invoice({ id: i, number: `${i}` }));

  it("pages through all invoices and sends the token only in the Authorization header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(calls.length === 1 ? page(100) : page(7)), { status: 200 });
    };
    const all = await fetchBitfakturaInvoices("firma", "secret-token-123", fetcher);
    expect(all).toHaveLength(107);
    expect(calls.map((c) => new URL(c.url).searchParams.get("page"))).toEqual(["1", "2"]);
    for (const c of calls) {
      expect(new URL(c.url).host).toBe("firma.bitfaktura.cz");
      expect(c.url).not.toContain("secret-token-123");
      expect((c.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token-123");
      expect(c.init.redirect).toBe("error");
    }
  });

  it("reports a bad token, a missing account and an unusable host", async () => {
    const answer = (status: number, body = "[]") => async () => new Response(body, { status });
    await expect(fetchBitfakturaInvoices("firma", "t0ken-xyz", answer(401))).rejects.toMatchObject({ code: "bitfaktura_unauthorized" });
    await expect(fetchBitfakturaInvoices("firma", "t0ken-xyz", answer(200, "<html>login</html>"))).rejects.toMatchObject({ code: "bitfaktura_unauthorized" });
    await expect(fetchBitfakturaInvoices("firma", "t0ken-xyz", answer(404))).rejects.toMatchObject({ code: "bitfaktura_account" });
    await expect(fetchBitfakturaInvoices("firma", "t0ken-xyz", answer(502))).rejects.toMatchObject({ code: "bitfaktura_unreachable" });
    const never = async () => {
      throw new Error("must not be called");
    };
    await expect(fetchBitfakturaInvoices("evil.com", "t0ken-xyz", never)).rejects.toBeInstanceOf(BitfakturaError);
  });
});
