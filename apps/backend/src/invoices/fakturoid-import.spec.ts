import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import fixture from "./fixtures/fakturoid.json";
import {
  connectFakturoid,
  fakturoidSlug,
  fetchFakturoidData,
  FakturoidError,
  mapFakturoidAccount,
  mapFakturoidInvoices,
  mapFakturoidSubjects,
  retryDelayMs,
  type FakturoidInvoice,
  type FakturoidSubject,
} from "./fakturoid-import";
import { InvoiceImportService } from "./invoice-import.service";

const API = "https://app.fakturoid.cz/api/v3";
const CREDENTIALS = { clientId: "test-client-id", clientSecret: "test-client-secret" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const invoices = fixture.invoices as unknown as FakturoidInvoice[];
const subjects = fixture.subjects as unknown as FakturoidSubject[];

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A Fakturoid stand-in answering from the fixture; `override` replaces single answers. */
function fakeFakturoid(override: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    const call: Call = { url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    calls.push(call);
    const custom = override(call);
    if (custom) return custom;
    const path = url.slice(API.length);
    if (path === "/oauth/token") return json(fixture.token);
    if (path === "/user.json") return json(fixture.user);
    if (path === "/accounts/applecorp/account.json") return json(fixture.account);
    if (path === "/accounts/applecorp/invoices.json?page=1") return json(fixture.invoices);
    if (path === "/accounts/applecorp/invoices.json?document_type=proforma&page=1") return json(fixture.proformas);
    if (path === "/accounts/applecorp/subjects.json?page=1") return json(fixture.subjects);
    const pdf = /^\/accounts\/applecorp\/invoices\/(\d+)\/download\.pdf$/.exec(path);
    if (pdf) return new Response(`%PDF-1.7 invoice ${pdf[1]}`, { status: 200, headers: { "content-type": "application/pdf" } });
    return json({ error: "not found" }, 404);
  };
  return { fetcher, calls };
}
const noSleep = vi.fn(async (_ms: number) => undefined);

describe("fakturoidSlug", () => {
  it("accepts a slug or a pasted app.fakturoid.cz URL", () => {
    expect(fakturoidSlug("applecorp")).toBe("applecorp");
    expect(fakturoidSlug(" https://app.fakturoid.cz/AppleCorp/invoices?page=2 ")).toBe("applecorp");
    expect(fakturoidSlug("app.fakturoid.cz/apple-corp_2")).toBe("apple-corp_2");
  });

  it("refuses anything that is not a plain slug", () => {
    expect(fakturoidSlug("")).toBeNull();
    expect(fakturoidSlug("../user")).toBeNull();
    expect(fakturoidSlug("evil.example.com")).toBeNull();
    expect(fakturoidSlug("a b")).toBeNull();
  });
});

describe("retryDelayMs", () => {
  const res = (headers: Record<string, string>) => ({ headers: new Headers(headers) });
  it("waits until Fakturoid's rate-limit window resets", () => {
    expect(retryDelayMs(res({ "x-ratelimit": "default;r=0;t=37" }), 0)).toBe(37_000);
    expect(retryDelayMs(res({ "retry-after": "5" }), 0)).toBe(5_000);
  });
  it("backs off on its own without a hint, within bounds", () => {
    expect(retryDelayMs(res({}), 0)).toBe(1_000);
    expect(retryDelayMs(res({}), 3)).toBe(8_000);
    expect(retryDelayMs(res({ "x-ratelimit": "default;r=0;t=900" }), 0)).toBe(60_000);
  });
});

describe("connectFakturoid", () => {
  it("buys a token with the client credentials, then only sends GETs with the token", async () => {
    const { fetcher, calls } = fakeFakturoid();
    const conn = await connectFakturoid(CREDENTIALS, { fetcher, sleep: noSleep });
    expect(conn.slug).toBe("applecorp");
    await fetchFakturoidData(conn);

    const [token, ...rest] = calls;
    expect(token!.method).toBe("POST");
    expect(token!.url).toBe(`${API}/oauth/token`);
    expect(token!.headers.Authorization).toBe(`Basic ${Buffer.from("test-client-id:test-client-secret").toString("base64")}`);
    expect(JSON.parse(token!.body!)).toEqual({ grant_type: "client_credentials" });
    expect(rest.length).toBeGreaterThan(0);
    for (const call of rest) {
      expect(call.method).toBe("GET");
      expect(call.headers.Authorization).toBe("Bearer test-access-token");
    }
    for (const call of calls) {
      // Fakturoid refuses requests without an "App (e-mail)" User-Agent.
      expect(call.headers["User-Agent"]).toMatch(/^Billanta .*\(.+@.+\)$/);
      expect(call.url).not.toMatch(/test-client|test-access-token/);
      expect(call.url.startsWith(`${API}/`)).toBe(true);
    }
  });

  it("uses the named account, the default one, or the only one", async () => {
    const two = { ...fixture.user, accounts: [{ slug: "applecorp" }, { slug: "druha" }] };
    const withUser = (user: unknown) => fakeFakturoid((c) => (c.url.endsWith("/user.json") ? json(user) : undefined)).fetcher;
    await expect(connectFakturoid({ ...CREDENTIALS, account: "https://app.fakturoid.cz/druha/" }, { fetcher: withUser(two) })).resolves.toMatchObject({ slug: "druha" });
    await expect(connectFakturoid(CREDENTIALS, { fetcher: withUser({ ...two, default_account: "druha" }) })).resolves.toMatchObject({ slug: "druha" });
    await expect(connectFakturoid(CREDENTIALS, { fetcher: withUser(two) })).rejects.toMatchObject({ code: "fakturoid_account" });
    await expect(connectFakturoid({ ...CREDENTIALS, account: "cizi" }, { fetcher: withUser(two) })).rejects.toMatchObject({ code: "fakturoid_account" });
    await expect(connectFakturoid({ ...CREDENTIALS, account: "not a slug!" }, { fetcher: withUser(two) })).rejects.toMatchObject({ code: "fakturoid_account" });
    // A typo must not quietly land on the only (or default) account instead.
    await expect(connectFakturoid({ ...CREDENTIALS, account: "not a slug!" }, { fetcher: withUser(fixture.user) })).rejects.toMatchObject({
      code: "fakturoid_account",
    });
  });

  it("reports wrong credentials, a blocked account and an unreachable API", async () => {
    const at = (path: string, res: () => Response) => fakeFakturoid((c) => (c.url.endsWith(path) ? res() : undefined)).fetcher;
    const code = (fetcher: ReturnType<typeof at>) =>
      connectFakturoid(CREDENTIALS, { fetcher, sleep: noSleep })
        .then(fetchFakturoidData)
        .then(
          () => "ok",
          (e: FakturoidError) => e.code,
        );
    expect(await code(at("/oauth/token", () => json({ error: "invalid_client" }, 400)))).toBe("fakturoid_unauthorized");
    expect(await code(at("/oauth/token", () => json({ error: "invalid_client" }, 401)))).toBe("fakturoid_unauthorized");
    expect(await code(at("/oauth/token", () => json({}, 200)))).toBe("fakturoid_unauthorized");
    expect(await code(at("/user.json", () => json({}, 403)))).toBe("fakturoid_unauthorized");
    expect(await code(at("invoices.json?page=1", () => json({ unpaid: [] }, 402)))).toBe("fakturoid_blocked");
    expect(await code(at("subjects.json?page=1", () => json({}, 500)))).toBe("fakturoid_unreachable");
    expect(
      await code(async () => {
        throw new TypeError("fetch failed");
      }),
    ).toBe("fakturoid_unreachable");
  });

  it("waits out a rate limit or maintenance and retries, then gives up", async () => {
    let limited = 2;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { fetcher } = fakeFakturoid((c) =>
      c.url.endsWith("/user.json") && limited-- > 0 ? json({}, limited === 1 ? 429 : 503, { "x-ratelimit": "default;r=0;t=7" }) : undefined,
    );
    await expect(connectFakturoid(CREDENTIALS, { fetcher, sleep })).resolves.toMatchObject({ slug: "applecorp" });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([7_000, 7_000]);

    const always = fakeFakturoid((c) => (c.url.endsWith("/user.json") ? json({}, 429) : undefined));
    await expect(connectFakturoid(CREDENTIALS, { fetcher: always.fetcher, sleep })).rejects.toMatchObject({ code: "fakturoid_unreachable" });
    expect(always.calls.filter((c) => c.url.endsWith("/user.json"))).toHaveLength(5);
  });

  it("pages through a list until a page is not full", async () => {
    const page = (n: number, size: number) => Array.from({ length: size }, (_, i) => ({ id: n * 100 + i, type: "customer", name: `K ${n}-${i}` }));
    const { fetcher, calls } = fakeFakturoid((c) => {
      const m = /subjects\.json\?page=(\d+)$/.exec(c.url);
      return m ? json(Number(m[1]) === 1 ? page(1, 40) : page(2, 3)) : undefined;
    });
    const conn = await connectFakturoid(CREDENTIALS, { fetcher });
    expect(await conn.list("subjects.json")).toHaveLength(43);
    expect(calls.filter((c) => c.url.includes("subjects.json")).map((c) => c.url.split("?")[1])).toEqual(["page=1", "page=2"]);
  });

  it("asks for proformas separately and keeps each document once", async () => {
    const { fetcher } = fakeFakturoid();
    const data = await fetchFakturoidData(await connectFakturoid(CREDENTIALS, { fetcher }));
    expect(data.invoices.map((i) => i.id)).toEqual([27, 28, 29, 30, 31, 32, 33, 34, 35, 36]);
    expect(data.subjects).toHaveLength(5);
    expect(data.account?.currency).toBe("CZK");
  });
});

describe("FakturoidConnection.pdf", () => {
  it("waits while the PDF is being generated (204) and returns it", async () => {
    let pending = 1;
    const sleep = vi.fn(async (_ms: number) => undefined);
    const { fetcher, calls } = fakeFakturoid((c) => (c.url.endsWith("/27/download.pdf") && pending-- > 0 ? new Response(null, { status: 204 }) : undefined));
    const conn = await connectFakturoid(CREDENTIALS, { fetcher, sleep });
    expect((await conn.pdf(27, 1_000_000))?.toString()).toBe("%PDF-1.7 invoice 27");
    expect(sleep).toHaveBeenCalledWith(2_000);
    const pdfCall = calls.find((c) => c.url.endsWith("/27/download.pdf"))!;
    expect(pdfCall.headers.Authorization).toBe("Bearer test-access-token");
  });

  it("gives up quietly on anything that is not a usable PDF", async () => {
    const { fetcher } = fakeFakturoid((c) => {
      if (c.url.endsWith("/1/download.pdf")) return new Response("<html>", { status: 200 });
      if (c.url.endsWith("/2/download.pdf")) return new Response(null, { status: 204 });
      if (c.url.endsWith("/3/download.pdf")) return new Response("gone", { status: 404 });
      if (c.url.endsWith("/5/download.pdf")) return new Response("%PDF-1.7 error page", { status: 500 });
      return undefined;
    });
    const conn = await connectFakturoid(CREDENTIALS, { fetcher, sleep: noSleep });
    expect(await conn.pdf(1, 1_000_000)).toBeNull();
    expect(await conn.pdf(2, 1_000_000)).toBeNull();
    expect(await conn.pdf(3, 1_000_000)).toBeNull();
    expect(await conn.pdf(4, 5)).toBeNull();
    expect(await conn.pdf(5, 1_000_000)).toBeNull();
    expect(await conn.pdf(-1, 1_000_000)).toBeNull();
  });
});

describe("mapFakturoidInvoices", () => {
  const all = [...invoices, ...(fixture.proformas.slice(1) as unknown as FakturoidInvoice[])];
  const { invoices: mapped, skipped } = mapFakturoidInvoices(all, "CZK", new Date("2026-01-01T00:00:00Z"));
  const byNumber = (n: string) => mapped.find((i) => i.invoiceNumber === n)!;

  it("keeps numbers, dates, VS, items and VAT rates as in the source", () => {
    const inv = byNumber("2023-0021");
    expect(inv).toMatchObject({
      documentType: "invoice",
      issueDate: new Date("2023-11-30T00:00:00Z"),
      taxableSupplyDate: new Date("2023-11-30T00:00:00Z"),
      dueDate: new Date("2023-12-14T00:00:00Z"),
      variableSymbol: "20230021",
      currency: "CZK",
      exchangeRate: null,
      status: "issued",
      amountPaid: 0,
      paymentMethod: "bank_transfer",
      language: "cs",
      reverseCharge: false,
      note: "Fakturujeme Vám následující položky",
      sourceId: 27,
    });
    expect(inv.lines).toEqual([
      { description: "Grafická karta", quantity: 1, unit: null, unitPrice: 8264, vatRate: 21 },
      { description: "Jídlo", quantity: 5, unit: "ks", unitPrice: 173.92, vatRate: 15 },
    ]);
    expect(inv.customer).toMatchObject({ legalName: "Apple Czech s.r.o.", ico: "28897501", dic: "CZ28897501", addressCity: "Praha", addressCountry: "CZ" });
    expect(inv.sellerSnapshot).toMatchObject({
      legalName: "Alexandr Hejsek",
      ico: "87654321",
      dic: "CZ12121212",
      addressStreet: "Hopsinková 14",
      bankAccountNumber: "1234",
      bankAccountBankCode: "2010",
      dicVatPayer: true,
      source: "import",
    });
    expect(inv.buyerSnapshot).toMatchObject({ legalName: "Apple Czech s.r.o.", ico: "28897501", capturedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("keeps a foreign invoice's rate, payments, custom payment method and notes", () => {
    const inv = byNumber("2023-0022");
    expect(inv).toMatchObject({
      currency: "EUR",
      exchangeRate: 24.35,
      status: "paid",
      paidAt: new Date("2023-12-10T00:00:00Z"),
      amountPaid: 1210,
      paymentMethod: "other",
      paymentMethodLabel: "Wise",
      language: "en",
      orderNumber: "PO-778",
      note: "Thank you for your order.\n\nRegistered in the Prague trade register.",
      internalNote: "Paid via Wise",
    });
    expect(inv.customer).toMatchObject({ ico: null, dic: "DE123456789", addressCountry: "DE" });
    expect(inv.sellerSnapshot).toMatchObject({ bankAccountIban: "CZ6508000000192000145399", bankAccountSwift: "GIBACZPX", bankAccountNumber: null });
  });

  it("maps credit notes, proformas and tax documents, each note once, and PayPal", () => {
    expect(byNumber("OD-2023-0001")).toMatchObject({
      documentType: "credit_note",
      variableSymbol: "20230001",
      paymentMethod: "other",
      paymentMethodLabel: "PayPal",
      language: "sk",
      note: "Oprava faktury 2023-0021",
    });
    expect(byNumber("OD-2023-0001").lines[0]).toMatchObject({ unitPrice: -1000, vatRate: 21 });
    expect(byNumber("ZF-2024-0001")).toMatchObject({
      documentType: "proforma",
      variableSymbol: "2024901",
      status: "paid",
      paidAt: new Date("2024-02-03T00:00:00Z"),
      paymentMethod: "card",
    });
    expect(byNumber("DD-2024-0001")).toMatchObject({ documentType: "invoice", status: "issued", paymentMethod: "cash", amountPaid: 60 });
    expect(byNumber("ZF-2024-0002")).toMatchObject({ documentType: "proforma", status: "issued" });
    expect(mapFakturoidInvoices([{ ...invoices[4]!, document_type: "partial_proforma" }]).invoices[0]!.documentType).toBe("proforma");
  });

  it("takes the net unit price, derived from a gross-priced line when the net field is missing", () => {
    expect(byNumber("ZF-2024-0002").lines[0]!.unitPrice).toBe(100);
    expect(byNumber("ZF-2024-0001").lines[0]!.unitPrice).toBeCloseTo(1000, 6);
  });

  it("reads reverse charge with its KH code, and partial payments", () => {
    expect(byNumber("2024-0001")).toMatchObject({ reverseCharge: true, reverseChargeCode: "4", status: "issued", amountPaid: 30000 });
    expect(byNumber("2023-0021").reverseChargeCode).toBeUndefined();
  });

  it("reads reverse charge from the printed sentence only on an invoice without VAT", () => {
    const sentence = { ...invoices[3]!, transferred_tax_liability: false, note: "Daň odvede zákazník." };
    expect(mapFakturoidInvoices([sentence]).invoices[0]!.reverseCharge).toBe(true);
    expect(mapFakturoidInvoices([{ ...invoices[0]!, note: "Daň odvede zákazník." }]).invoices[0]!.reverseCharge).toBe(false);
  });

  it("keeps cancelled ones cancelled, an unknown language out, cash on delivery", () => {
    expect(byNumber("2024-0002")).toMatchObject({ status: "cancelled", paymentMethod: "cash_on_delivery", language: undefined, amountPaid: 0 });
  });

  it("skips what it cannot represent, and a number seen twice", () => {
    const twice = mapFakturoidInvoices([invoices[0]!, { ...invoices[0]!, id: 99 }, { ...invoices[0]!, number: "" }, { ...invoices[0]!, number: "X", client_name: " " }, { ...invoices[0]!, number: "Y", issued_on: "30.11.2023" }]);
    expect(twice.skipped.map((s) => s.reason)).toEqual(["duplicate_in_file", "missing_number", "missing_customer", "invalid_date"]);
    expect(skipped).toEqual([
      { line: 8, number: "NAB-2024-0001", reason: "unsupported_kind" },
      { line: 9, number: "2024-0003", reason: "invalid_amount" },
    ]);
    expect(mapped).toHaveLength(8);
  });

  it("drops the rate on an account kept in another currency, so the ČNB one is looked up", () => {
    const eurAccount = mapFakturoidInvoices([invoices[1]!], "EUR");
    expect(eurAccount.invoices[0]!.exchangeRate).toBeNull();
    const placeholder = mapFakturoidInvoices([{ ...invoices[1]!, exchange_rate: "1.0" }], "CZK");
    expect(placeholder.invoices[0]!.exchangeRate).toBeNull();
  });

  it("keeps a KH code only on a domestic reverse charge", () => {
    const foreign = mapFakturoidInvoices([{ ...invoices[3]!, client_country: "SK" }]);
    expect(foreign.invoices[0]!.reverseChargeCode).toBeUndefined();
    const noRc = mapFakturoidInvoices([{ ...invoices[3]!, transferred_tax_liability: false, note: null }]);
    expect(noRc.invoices[0]).toMatchObject({ reverseCharge: false });
    expect(noRc.invoices[0]!.reverseChargeCode).toBeUndefined();
  });
});

describe("mapFakturoidSubjects", () => {
  const contacts = mapFakturoidSubjects(subjects);

  it("brings customers over, with phone and contact person, and leaves suppliers out", () => {
    expect(contacts.map((c) => c.legalName)).toEqual(["Apple Czech s.r.o.", "Slovenská firma s.r.o."]);
    expect(contacts[0]).toMatchObject({ ico: "28897501", dic: "CZ28897501", email: "pokus@test.cz", addressPostalCode: "11000", addressCountry: "CZ" });
    expect(contacts[0]!.internalNote).toBeUndefined();
    expect(contacts[0]!.contactPerson).toBeUndefined();
    expect(contacts[1]).toMatchObject({
      ico: "12345678",
      dic: "SK2023513470",
      phone: "+421 900 123 456",
      addressCountry: "SK",
      contactPerson: "Ján Kováč",
      internalNote: "Platí vždy pozdě.",
    });
  });
});

describe("mapFakturoidAccount", () => {
  it("fills the business details the account has", () => {
    expect(mapFakturoidAccount(fixture.account)).toEqual({
      ico: "87654321",
      dic: "CZ12121212",
      addressStreet: "Hopsinková 14",
      addressCity: "Praha",
      addressPostalCode: "10000",
      addressCountry: "CZ",
    });
  });
  it("gives nothing for an empty or missing account", () => {
    expect(mapFakturoidAccount(null)).toBeNull();
    expect(mapFakturoidAccount({ name: "Jen jméno", street: "info@example.cz", city: "Praha" })).toBeNull();
  });
});

describe("InvoiceImportService.importFromFakturoid", () => {
  async function run(dryRun: boolean, override?: (call: Call) => Response | undefined) {
    const record = vi.fn(async (..._args: unknown[]) => undefined);
    const service = new InvoiceImportService({ record } as never);
    const inserted: { table: unknown; values: Record<string, unknown> }[] = [];
    const db = {
      insert: (table: unknown) => ({ values: async (values: Record<string, unknown>) => void inserted.push({ table, values }) }),
      select: () => ({ from: () => ({ where: async () => [{ ico: null, dic: null, registryNote: null, addressStreet: null, addressCity: null, addressPostalCode: null, addressCountry: "CZ" }] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    let contacts: unknown;
    let seen: { invoiceNumber: string; exchangeRate?: number | null }[] = [];
    vi.spyOn(service as never, "importMapped").mockImplementation((async (
      _db: unknown,
      _t: string,
      mapped: { invoices: { invoiceNumber: string }[] },
      dry: boolean,
      onCreated?: (inv: unknown, id: string) => void,
      c?: unknown,
    ) => {
      contacts = c;
      seen = mapped.invoices;
      if (!dry) mapped.invoices.forEach((inv, i) => onCreated?.(inv, `inv-${i}`));
      return { dryRun: dry, invoices: mapped.invoices.length };
    }) as never);
    const fake = fakeFakturoid(override);
    const result = await service.importFromFakturoid(db as never, "tenant-1", CREDENTIALS, dryRun, { fetcher: fake.fetcher, sleep: noSleep });
    return { result, inserted, record, contacts, calls: fake.calls, mapped: seen };
  }

  it("reads the rate against the account's own currency", async () => {
    const rate = (m: { invoiceNumber: string; exchangeRate?: number | null }[]) => m.find((i) => i.invoiceNumber === "2023-0022")!.exchangeRate;
    expect(rate((await run(true)).mapped)).toBe(24.35);
    const eur = await run(true, (c) => (c.url.endsWith("/account.json") ? json({ ...fixture.account, currency: "EUR" }) : undefined));
    expect(rate(eur.mapped)).toBeNull();
  });

  it("previews without downloading PDFs or writing anything", async () => {
    const { result, inserted, record, contacts, calls } = await run(true);
    expect(result.source).toEqual({ invoices: 10, contacts: 5 });
    expect(result.invoices).toBe(8);
    expect(result.businessFilled).toEqual(["ico", "dic", "addressStreet", "addressCity", "addressPostalCode", "addressCountry"]);
    expect(contacts).toHaveLength(2);
    expect(calls.some((c) => c.url.endsWith(".pdf"))).toBe(false);
    expect(inserted).toEqual([]);
    expect(record).not.toHaveBeenCalled();
  });

  it("archives each original PDF privately and logs a Fakturoid run", async () => {
    const { result, inserted, record } = await run(false, (c) => (c.url.endsWith("/29/download.pdf") ? new Response("nope", { status: 404 }) : undefined));
    expect(result.originalPdfs).toEqual({ archived: 7, missing: 1 });
    const rows = inserted.filter((r) => r.table === schema.invoiceAttachments).map((r) => r.values);
    const first = rows.find((r) => r.filename === "2023-0021-fakturoid.pdf")!;
    expect(first).toMatchObject({ tenantId: "tenant-1", mime: "application/pdf", sendWithEmail: false, showInPortal: false });
    expect(Buffer.from(String(first.data), "base64").toString()).toBe("%PDF-1.7 invoice 27");
    expect(record).toHaveBeenCalledTimes(1);
    expect((record.mock.calls[0] as unknown[])[2]).toMatchObject({ entityType: "import", action: "fakturoid" });
  });

  it("turns API errors into translated error codes", async () => {
    const err = await run(true, (c) => (c.url.endsWith("/oauth/token") ? json({ error: "invalid_client" }, 401) : undefined)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual({ error: "fakturoid_unauthorized" });
  });
});
