import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { BuyerContact } from "../invoices/buyer-details.util";
import { ProfileOrdersService } from "./profile-orders.service";

const buyer = {
  name: "Nová firma s.r.o.",
  email: "objednavky@firma.cz",
  street: "Dlouhá 1",
  city: "Praha",
  postalCode: "11000",
  country: "CZ",
  ico: "12345678",
};

const body = (over: Record<string, unknown> = {}) => ({ serviceId: "web001", quantity: 2, buyer, note: "Rychle prosím", ...over });

function setup(opts: { target?: string | null; orders?: Record<string, unknown>; today?: number; match?: BuyerContact | null; vatStatus?: string } = {}) {
  const tenant = {
    id: "t-1",
    addressCountry: "CZ",
    vatStatus: opts.vatStatus ?? "payer",
    defaultLocale: "cs",
    companyName: "Novák s.r.o.",
    bankAccountIban: null,
    bankAccountNumber: "19-2000145399",
    bankAccountBankCode: "0800",
    bankAccountSwift: null,
    publicProfile: {
      enabled: true,
      slug: "novak",
      orders: opts.orders ?? { enabled: true },
      services: [{ id: "web001", title: "Web na míru", unitPrice: 15000, unit: "ks" }],
    },
  };
  const db = { execute: vi.fn(async () => []) };
  const buyerDetails = {
    inTenant: vi.fn(async (_t: string, _a: string, fn: (db: never) => Promise<unknown>) => fn(db as never)),
    findByIdentifier: vi.fn(async () => opts.match ?? null),
    insertContact: vi.fn(async () => "c-new"),
    updateContact: vi.fn(),
  };
  const notifications = { notify: vi.fn() };
  const audit = { record: vi.fn(async () => undefined) };
  const svc = new ProfileOrdersService({} as never, buyerDetails as never, notifications as never, audit as never);
  vi.spyOn(svc, "target").mockResolvedValue(opts.target === undefined ? "t-1" : opts.target);
  vi.spyOn(svc, "loadTenant").mockResolvedValue(tenant as never);
  vi.spyOn(svc, "countToday").mockResolvedValue(opts.today ?? 0);
  const insertDraft = vi.spyOn(svc, "insertDraft").mockResolvedValue("inv-1");
  return { svc, db, buyerDetails, notifications, audit, insertDraft };
}

describe("ProfileOrdersService.submit", () => {
  it("creates a pending draft with a new contact and the service's own price, and notifies the owner", async () => {
    const t = setup();
    expect(await t.svc.submit("novak", body())).toEqual({ payment: null });
    expect(t.db.execute).toHaveBeenCalledTimes(1); // the per-company advisory lock
    expect(t.buyerDetails.insertContact).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ legalName: "Nová firma s.r.o.", email: "objednavky@firma.cz" }));
    expect(t.insertDraft).toHaveBeenCalledWith(
      expect.anything(),
      "t-1",
      expect.objectContaining({
        contactId: "c-new",
        currency: "CZK",
        needsAttention: false,
        variableSymbol: null,
        lines: [{ description: "Web na míru", quantity: 2, unit: "ks", unitPrice: 15000, vatRate: 21 }],
      }),
    );
    expect(t.insertDraft.mock.calls[0]![2].internalNote).toContain("Rychle prosím");
    expect(t.audit.record).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ entityType: "invoice", entityId: "inv-1", action: "profile_order" }));
    expect(t.notifications.notify).toHaveBeenCalledWith("t-1", "buyer_details", expect.objectContaining({ link: "/invoices/inv-1" }));
  });

  it("attaches a contact matched by IČO without writing to it", async () => {
    const match: BuyerContact = {
      id: "c-saved",
      legalName: "Úplně jiná firma",
      isPerson: false,
      email: "puvodni@firma.cz",
      ico: "12345678",
      dic: null,
      addressStreet: "Jinde 2",
      addressCity: "Brno",
      addressPostalCode: "60200",
      addressCountry: "CZ",
    };
    const t = setup({ match });
    await t.svc.submit("novak", body());
    expect(t.buyerDetails.insertContact).not.toHaveBeenCalled();
    expect(t.buyerDetails.updateContact).not.toHaveBeenCalled();
    // The differing name/address are conflicts → the draft is flagged for a closer look.
    expect(t.insertDraft).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ contactId: "c-saved", needsAttention: true }));
  });

  it("answers a bot like a success and stores nothing", async () => {
    const t = setup();
    await t.svc.submit("novak", body({ website: "https://spam.example" }));
    expect(t.buyerDetails.inTenant).not.toHaveBeenCalled();
    expect(t.notifications.notify).not.toHaveBeenCalled();
  });

  it("validates before touching the database", async () => {
    const t = setup();
    await expect(t.svc.submit("novak", body({ buyer: { ...buyer, email: null } }))).rejects.toBeInstanceOf(BadRequestException);
    expect(t.svc.target).not.toHaveBeenCalled();
  });

  it("is a 404 when the profile takes no orders, also if it was switched off a moment ago", async () => {
    await expect(setup({ target: null }).svc.submit("novak", body())).rejects.toBeInstanceOf(NotFoundException);
    const t = setup({ orders: { enabled: false } });
    await expect(t.svc.submit("novak", body())).rejects.toBeInstanceOf(NotFoundException);
    expect(t.insertDraft).not.toHaveBeenCalled();
  });

  it("stops at the company's daily cap with 429", async () => {
    const t = setup({ today: 30 });
    const err = await t.svc.submit("novak", body()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(t.insertDraft).not.toHaveBeenCalled();
  });

  it("refuses custom items unless the owner allows them, and prices them at 0 when allowed", async () => {
    const items = { serviceId: null, customItems: [{ description: "Úprava loga", quantity: 1 }] };
    await expect(setup().svc.submit("novak", body(items))).rejects.toMatchObject({ response: { error: "custom_items_disabled" } });
    const t = setup({ orders: { enabled: true, customItems: true }, vatStatus: "non_payer" });
    await t.svc.submit("novak", body(items));
    expect(t.insertDraft).toHaveBeenCalledWith(
      expect.anything(),
      "t-1",
      expect.objectContaining({ needsAttention: true, lines: [{ description: "Úprava loga", quantity: 1, unit: null, unitPrice: 0, vatRate: null }] }),
    );
  });

  it("with Platba předem, returns the payment details and keeps the same variable symbol on the draft", async () => {
    const t = setup({ orders: { enabled: true, prepay: true } });
    const { payment } = await t.svc.submit("novak", body());
    expect(payment).toMatchObject({ amount: 36300, currency: "CZK", iban: "CZ6508000000192000145399", recipient: "Novák s.r.o." });
    expect(payment!.variableSymbol).toMatch(/^9\d{9}$/);
    expect(t.insertDraft.mock.calls[0]![2].variableSymbol).toBe(payment!.variableSymbol);
    expect(t.insertDraft.mock.calls[0]![2].internalNote).toContain(payment!.variableSymbol);
  });

  it("rejects a service id that is not on the profile", async () => {
    await expect(setup().svc.submit("novak", body({ serviceId: "zzz999" }))).rejects.toMatchObject({ response: { error: "unknown_service" } });
  });
});
