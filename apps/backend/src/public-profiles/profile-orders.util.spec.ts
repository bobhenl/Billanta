import { describe, expect, it } from "vitest";
import { publicProfileSchema } from "../tenants/public-profile";
import { defaultVatRate, orderBlock, orderInternalNote, orderLines, orderPayment, parseProfileOrder, pragueDayStart, prepayVariableSymbol } from "./profile-orders.util";

const buyer = {
  name: "Nová firma s.r.o.",
  email: "Objednavky@Firma.cz",
  street: "Dlouhá 1",
  city: "Praha",
  postalCode: "11000",
  country: "CZ",
  ico: "12345678",
  dic: "",
};

const profile = (orders: { enabled?: boolean; customItems?: boolean } = { enabled: true }) =>
  publicProfileSchema.parse({
    enabled: true,
    slug: "novak",
    orders,
    services: [
      { id: "web001", title: "Web na míru", unitPrice: 15000, unit: "ks" },
      { id: "kon002", title: "Konzultace", price: "dle dohody" },
    ],
  });

describe("parseProfileOrder", () => {
  it("accepts a valid order and normalises the buyer", () => {
    const r = parseProfileOrder({ serviceId: "WEB001", quantity: 2, buyer, note: "  Do konce měsíce  " });
    expect(r.kind).toBe("order");
    if (r.kind !== "order") return;
    expect(r.order).toMatchObject({ serviceId: "web001", quantity: 2, customItems: [], note: "Do konce měsíce" });
    expect(r.order.buyer).toMatchObject({ legalName: "Nová firma s.r.o.", email: "objednavky@firma.cz", ico: "12345678", dic: null });
  });

  it("treats a filled honeypot as a bot, whatever else the body holds", () => {
    expect(parseProfileOrder({ website: "http://spam.example", buyer: {} }).kind).toBe("bot");
    expect(parseProfileOrder({ website: "   ", serviceId: "web001", buyer }).kind).toBe("order");
  });

  it("requires the buyer's e-mail and reports the field", () => {
    const r = parseProfileOrder({ serviceId: "web001", buyer: { ...buyer, email: "" } });
    expect(r).toMatchObject({ kind: "invalid", issues: [{ path: "buyer.email", message: "email_required" }] });
  });

  it("rejects unknown keys, oversized texts and silly quantities", () => {
    const bad = [
      { serviceId: "web001", buyer, extra: 1 },
      { serviceId: "web001", buyer, note: "x".repeat(1001) },
      { serviceId: "web001", buyer, quantity: 0 },
      { serviceId: "web001", buyer, quantity: 10_001 },
      { serviceId: "web001", buyer, quantity: 1.0005 },
      { serviceId: "../etc", buyer },
      { serviceId: "web001", buyer, customItems: Array.from({ length: 6 }, () => ({ description: "Něco", quantity: 1 })) },
      { serviceId: "web001", buyer, customItems: [{ description: "x".repeat(201), quantity: 1 }] },
      { serviceId: "web001", buyer, customItems: [{ description: "Něco", quantity: 1, unitPrice: 5 }] },
      { serviceId: "web001", buyer: { ...buyer, name: "x".repeat(201) } },
      "not an object",
    ];
    for (const body of bad) expect(parseProfileOrder(body).kind, JSON.stringify(body).slice(0, 80)).toBe("invalid");
  });
});

describe("orderBlock", () => {
  it("is closed unless the profile is published and takes orders, then caps per day", () => {
    expect(orderBlock({ profile: profile({ enabled: false }), todayCount: 0, dailyCap: 30 })).toBe("disabled");
    expect(orderBlock({ profile: { ...profile(), enabled: false }, todayCount: 0, dailyCap: 30 })).toBe("disabled");
    expect(orderBlock({ profile: profile(), todayCount: 29, dailyCap: 30 })).toBeNull();
    expect(orderBlock({ profile: profile(), todayCount: 30, dailyCap: 30 })).toBe("daily_cap");
  });
});

describe("orderLines", () => {
  it("takes the service's own name, price and unit, never the visitor's", () => {
    const r = orderLines({ serviceId: "web001", quantity: 3, customItems: [] }, profile(), 21);
    expect(r).toEqual({
      lines: [{ description: "Web na míru", quantity: 3, unit: "ks", unitPrice: 15000, vatRate: 21 }],
      needsAttention: false,
      serviceTitle: "Web na míru",
    });
  });

  it("puts an unpriced service in at 0 and flags the draft", () => {
    const r = orderLines({ serviceId: "kon002", quantity: 1, customItems: [] }, profile(), null);
    expect(r).toMatchObject({ lines: [{ unitPrice: 0, unit: null }], needsAttention: true });
  });

  it("accepts custom items only when the owner allows them, always at 0", () => {
    const items = [{ description: "Logo  navíc", quantity: 2 }];
    expect(orderLines({ serviceId: "web001", quantity: 1, customItems: items }, profile(), null)).toEqual({ error: "custom_items_disabled" });
    const r = orderLines({ serviceId: null, quantity: 1, customItems: items }, profile({ enabled: true, customItems: true }), 21);
    expect(r).toEqual({ lines: [{ description: "Logo navíc", quantity: 2, unit: null, unitPrice: 0, vatRate: 21 }], needsAttention: true, serviceTitle: null });
  });

  it("rejects an unknown service and an empty order", () => {
    expect(orderLines({ serviceId: "nope00", quantity: 1, customItems: [] }, profile(), null)).toEqual({ error: "unknown_service" });
    expect(orderLines({ serviceId: null, quantity: 1, customItems: [] }, profile({ enabled: true, customItems: true }), null)).toEqual({ error: "empty_order" });
  });
});

describe("helpers", () => {
  it("starts VAT payers on the standard rate of their country", () => {
    expect(defaultVatRate("payer", "CZ")).toBe(21);
    expect(defaultVatRate("payer", "SK")).toBe(23);
    expect(defaultVatRate("non_payer", "CZ")).toBeNull();
    expect(defaultVatRate("identified", "CZ")).toBeNull();
  });

  it("writes the customer's e-mail and note into the internal note", () => {
    const note = orderInternalNote({ email: "a@b.cz", note: "Volejte po 17:00", customItems: 1, contactMatched: true });
    expect(note).toContain("a@b.cz");
    expect(note).toContain("Volejte po 17:00");
    expect(note).toContain("cenu 0");
    expect(note).toContain("kontakt jsme neměnili");
    expect(orderInternalNote({ email: null, note: null, customItems: 0, contactMatched: false })).toBe("Objednávka z veřejného profilu.");
  });

  it("counts the day from midnight in Prague, not UTC", () => {
    // 23:30 UTC on 1 July = 01:30 on 2 July in Prague (CEST).
    expect(pragueDayStart(new Date("2026-07-01T23:30:00Z")).toISOString()).toBe("2026-07-01T22:00:00.000Z");
    // Winter: CET is UTC+1.
    expect(pragueDayStart(new Date("2026-01-15T10:00:00Z")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });
});

describe("orderPayment (Platba předem)", () => {
  const tenant = { companyName: "Novák s.r.o.", bankAccountIban: null, bankAccountNumber: "19-2000145399", bankAccountBankCode: "0800", bankAccountSwift: null };
  const lines = [
    { description: "Web", quantity: 2, unit: "ks", unitPrice: 1000, vatRate: 21 },
    { description: "Logo", quantity: 1, unit: null, unitPrice: 500.5, vatRate: 12 },
  ];
  const base = { prepay: true, lines, needsPricing: false, currency: "CZK", variableSymbol: "9000000042", tenant };

  it("asks for the total with VAT to the company's account, with an IBAN for the QR code", () => {
    expect(orderPayment(base)).toEqual({
      amount: 2980.56,
      currency: "CZK",
      variableSymbol: "9000000042",
      iban: "CZ6508000000192000145399",
      accountNumber: "19-2000145399/0800",
      bic: null,
      recipient: "Novák s.r.o.",
    });
  });

  it("asks for nothing when off, when the owner still has to price something, or without an account", () => {
    expect(orderPayment({ ...base, prepay: false })).toBeNull();
    expect(orderPayment({ ...base, needsPricing: true })).toBeNull();
    expect(orderPayment({ ...base, lines: [{ ...lines[0]!, unitPrice: 0 }] })).toBeNull();
    expect(orderPayment({ ...base, tenant: { ...tenant, bankAccountNumber: null } })).toBeNull();
  });

  it("prefers the stored IBAN", () => {
    expect(orderPayment({ ...base, tenant: { ...tenant, bankAccountIban: "SK31 1200 0000 1987 4263 7541" } })?.iban).toBe("SK3112000000198742637541");
  });

  it("makes 10-digit variable symbols starting with 9", () => {
    expect(prepayVariableSymbol(() => 42)).toBe("9000000042");
    expect(prepayVariableSymbol()).toMatch(/^9\d{9}$/);
  });
});
