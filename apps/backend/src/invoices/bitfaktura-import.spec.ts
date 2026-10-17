import { describe, expect, it } from "vitest";
import {
  bitfakturaBaseUrl,
  BitfakturaError,
  fetchBitfakturaClients,
  fetchBitfakturaInvoices,
  fetchBitfakturaPdf,
  mapBitfakturaClients,
  mapBitfakturaSeller,
  mapBitfakturaInvoices,
  type BitfakturaClient,
  type BitfakturaInvoice,
} from "./bitfaktura-import";

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

describe("fetchBitfakturaPdf", () => {
  const pdf = Buffer.from("%PDF-1.4 original");

  it("returns the original PDF, asked for with the token in the header only", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const got = await fetchBitfakturaPdf("firma", "secret-token-123", 42, 1000, async (url, init) => {
      seen = { url, init };
      return new Response(pdf, { status: 200 });
    });
    expect(got?.equals(pdf)).toBe(true);
    expect(seen!.url).toBe("https://firma.bitfaktura.cz/invoices/42.pdf");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token-123");
    expect(seen!.init.redirect).toBe("error");
  });

  it("gives up quietly on anything that is not a usable PDF", async () => {
    const answer = (body: Buffer | string, status = 200) => async () => new Response(body, { status });
    expect(await fetchBitfakturaPdf("firma", "t0ken-xyz", 42, 1000, answer("<html>login</html>"))).toBeNull();
    expect(await fetchBitfakturaPdf("firma", "t0ken-xyz", 42, 1000, answer(pdf, 404))).toBeNull();
    expect(await fetchBitfakturaPdf("firma", "t0ken-xyz", 42, 10, answer(pdf))).toBeNull();
    expect(
      await fetchBitfakturaPdf("firma", "t0ken-xyz", 42, 1000, async () => {
        throw new Error("network");
      }),
    ).toBeNull();
    let calls = 0;
    const counted = async () => {
      calls++;
      return new Response(pdf, { status: 200 });
    };
    expect(await fetchBitfakturaPdf("evil.com", "t0ken-xyz", 42, 1000, counted)).toBeNull();
    expect(await fetchBitfakturaPdf("firma", "t0ken-xyz", -1, 1000, counted)).toBeNull();
    expect(await fetchBitfakturaPdf("firma", "t0ken-xyz", 1.5, 1000, counted)).toBeNull();
    expect(calls).toBe(0);
  });

  it("keeps the source id on mapped invoices so the PDF can be fetched", () => {
    expect(mapBitfakturaInvoices([invoice({ id: 777 })]).invoices[0]!.sourceId).toBe(777);
  });
});

describe("mapBitfakturaClients", () => {
  const client = (over: Partial<BitfakturaClient> = {}): BitfakturaClient => ({ id: 1, name: "Acme s.r.o.", tax_no: "27082440", company: true, ...over });

  it("reads IČO or VAT ID, email, address and country like the invoice buyer", () => {
    const [cz, it_] = mapBitfakturaClients([
      client({ email: " info@acme.cz ", street: "Dlouhá 1", city: "Praha", post_code: "11000", country: "CZ" }),
      client({ id: 2, name: "Rossi Srl", tax_no: "IT 01234567891", email: "not-an-email", country: "IT" }),
    ]);
    expect(cz).toEqual({
      legalName: "Acme s.r.o.",
      ico: "27082440",
      dic: null,
      email: "info@acme.cz",
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressPostalCode: "11000",
      addressCountry: "CZ",
    });
    expect(it_).toMatchObject({ legalName: "Rossi Srl", ico: null, dic: "IT01234567891", email: null, addressCountry: "IT" });
  });

  it("marks people, builds a name from first and last name and keeps the phone in the internal note", () => {
    const [jan, eva] = mapBitfakturaClients([
      client({ name: "", first_name: "Jan", last_name: "Novák", tax_no: null, company: false, phone: "+420 777 123 456", note: "Platí pozdě" }),
      client({ id: 2, name: "Eva", tax_no: null, company: null, mobile_phone: "603 000 000" }),
    ]);
    expect(jan).toMatchObject({ legalName: "Jan Novák", isPerson: true, internalNote: "Tel. +420 777 123 456\nPlatí pozdě" });
    expect(eva).toMatchObject({ legalName: "Eva", internalNote: "Tel. 603 000 000" });
    expect(eva).not.toHaveProperty("isPerson");
  });

  it("keeps one contact per IČO or name and leaves out nameless ones", () => {
    const out = mapBitfakturaClients([
      client(),
      client({ id: 2, name: "Acme (old name)" }),
      client({ id: 3, name: "Beta", tax_no: null }),
      client({ id: 4, name: "BETA", tax_no: null }),
      client({ id: 5, name: "  ", first_name: null, last_name: null, tax_no: null }),
    ]);
    expect(out.map((c) => c.legalName)).toEqual(["Acme s.r.o.", "Beta"]);
    expect(out[1]).not.toHaveProperty("internalNote");
  });
});

describe("fetchBitfakturaClients", () => {
  it("pages through clients.json with the token only in the Authorization header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const n = calls.length === 1 ? 100 : 3;
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, name: `c${i}` }))), { status: 200 });
    };
    expect(await fetchBitfakturaClients("firma", "secret-token-123", fetcher)).toHaveLength(103);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/clients.json", "/clients.json"]);
    expect(calls.map((c) => new URL(c.url).searchParams.get("page"))).toEqual(["1", "2"]);
    for (const c of calls) {
      expect(c.url).not.toContain("secret-token-123");
      expect((c.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token-123");
    }
    await expect(fetchBitfakturaClients("firma", "t0ken-xyz", async () => new Response("[]", { status: 401 }))).rejects.toMatchObject({
      code: "bitfaktura_unauthorized",
    });
  });
});

describe("e-mail typed into the address", () => {
  it("is used as the e-mail and kept out of the address", () => {
    const [bare, both, inCity] = mapBitfakturaClients([
      { id: 1, name: "Brandon", street: "Contact@brandhyde.com", country: "GB" },
      { id: 2, name: "Gabe", street: "gabe@example.com", email: "billing@example.com" },
      { id: 3, name: "Kamran", street: "Main St 1", city: "k@example.com" },
    ]);
    expect(bare).toMatchObject({ email: "Contact@brandhyde.com", addressStreet: null, addressCity: null, addressCountry: "GB" });
    expect(both).toMatchObject({ email: "billing@example.com", addressStreet: null });
    expect(inCity).toMatchObject({ email: "k@example.com", addressStreet: "Main St 1", addressCity: null });
  });

  it("works the same for invoice buyers", () => {
    const { invoices } = mapBitfakturaInvoices([invoice({ buyer_street: "mail@cintro.dev", buyer_email: "", buyer_city: "" })]);
    expect(invoices[0]!.customer).toMatchObject({ email: "mail@cintro.dev", addressStreet: null });
  });
});

describe("mapBitfakturaSeller", () => {
  const dept = { id: 1, main: true, name: "Jan Novák", tax_no: "CZ8001011234", register_number: "12345678", street: "Dlouhá 1", city: "Praha", post_code: "110 00" };

  it("reads IČO, DIČ, address and the trade-register line of the main profile", () => {
    expect(
      mapBitfakturaSeller([
        { ...dept, id: 2, main: false, street: "Jiná 5" },
        { ...dept, additional_fields: { seller_trade_register_cz: " Fyzická osoba zapsaná v živnostenském rejstříku. " } },
      ]),
    ).toEqual({
      ico: "12345678",
      dic: "CZ8001011234",
      addressStreet: "Dlouhá 1",
      addressCity: "Praha",
      addressPostalCode: "110 00",
      addressCountry: "CZ",
      registryNote: "Fyzická osoba zapsaná v živnostenském rejstříku.",
    });
  });

  it("takes an 8-digit tax number as the IČO, skips deleted profiles and half addresses", () => {
    expect(mapBitfakturaSeller([{ ...dept, deleted: true }, { id: 3, tax_no: "27082440", register_number: null, street: "Dlouhá 1", city: "" }])).toEqual({ ico: "27082440" });
    expect(mapBitfakturaSeller([{ id: 4, tax_no: "", street: "x@example.com", city: "Praha" }])).toBeNull();
    expect(mapBitfakturaSeller([])).toBeNull();
  });
});
