import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanSummary } from "../billing/plan.guard";
import { createContactSchema } from "../contacts/dto/create-contact.dto";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { clientPortalLinkOf } from "../public-links/public-link";
import { templateValues } from "../tenants/template-vars";
import { emailCustomizationOf, emailPrefsOf } from "../tenants/email-prefs";
import { assertContactShape, assertContactWrite, contactLabel, redactSealedContact } from "./sealed-contacts";
import { SEALED_PLACEHOLDER } from "./sealed";
import { documentIsSealed, withOpenedBuyer } from "./vault-email";

vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: vi.fn() }));

// Distinct well-formed envelopes (company key).
const env = (n: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(20 + n)}`;

/** `.select().from().where().limit()` answering with the vault row. */
function vaultDb(categories: string[] | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "from", "where"]) chain[m] = () => chain;
  chain.limit = vi.fn(async () => (categories ? [{ categories }] : []));
  return chain as never;
}

const error = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e as Error;
  }
  return null;
};

describe("assertContactShape", () => {
  it("refuses plain text in a sealed contact (400 contact_plaintext)", async () => {
    const e = await error(() => assertContactShape({ legalName: env(1), addressStreet: "Dlouhá 5" }));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e?.message).toBe("contact_plaintext");
  });

  it("refuses a plain phone and a plain ZIP in a sealed contact too", async () => {
    expect((await error(() => assertContactShape({ legalName: env(1), phone: "+420 777 000 111" })))?.message).toBe("contact_plaintext");
    expect((await error(() => assertContactShape({ legalName: env(1), addressPostalCode: "11000" })))?.message).toBe("contact_plaintext");
  });

  it("refuses an envelope in a plain contact (400 contact_partly_sealed)", async () => {
    const e = await error(() => assertContactShape({ legalName: "Novák s.r.o.", internalNote: env(2) }));
    expect(e?.message).toBe("contact_partly_sealed");
    expect((await error(() => assertContactShape({ legalName: "Novák s.r.o.", email: env(2) })))?.message).toBe("contact_partly_sealed");
  });

  it("lets a sealed contact keep a plain e-mail, and empty fields", () => {
    expect(() => assertContactShape({ legalName: env(1), addressCity: env(2), email: "a@b.cz", phone: null, contactPerson: "" })).not.toThrow();
  });
});

describe("assertContactWrite", () => {
  const plan = vi.mocked(loadPlanSummary);
  beforeEach(() => {
    plan.mockReset();
    plan.mockResolvedValue({ plan: "plus", enforced: true } as never);
  });

  it("refuses plain text over a sealed contact (409 contact_sealed)", async () => {
    const e = await error(assertContactWrite(vaultDb(["texts", "contacts"]), "t1", { legalName: "Novák s.r.o." }, { legalName: env(1) }));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e?.message).toBe("contact_sealed");
  });

  it("refuses a plain field added to a sealed contact", async () => {
    const e = await error(assertContactWrite(vaultDb(["contacts"]), "t1", { addressCity: "Brno" }, { legalName: env(1) }));
    expect(e?.message).toBe("contact_plaintext");
  });

  it("refuses sealing without the plan", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    const e = await error(assertContactWrite(vaultDb(["texts", "contacts"]), "t1", { legalName: env(1) }, null));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect((e as ForbiddenException).getResponse()).toMatchObject({ error: "plan_required", feature: "confidential_mode" });
  });

  it("refuses sealing with the contacts category off (403 vault_category_off)", async () => {
    const e = await error(assertContactWrite(vaultDb(["texts"]), "t1", { legalName: env(1) }, null));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e?.message).toBe("vault_category_off");
    expect((await error(assertContactWrite(vaultDb(null), "t1", { legalName: env(1) }, null)))?.message).toBe("vault_category_off");
  });

  it("stores a sealed contact with the plan and the category", async () => {
    await expect(assertContactWrite(vaultDb(["texts", "contacts"]), "t1", { legalName: env(1), addressCity: env(2) }, null)).resolves.toBeUndefined();
  });

  it("keeps an already sealed contact editable after a downgrade or with the category off", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    await expect(assertContactWrite(vaultDb(["texts"]), "t1", { addressCity: env(3) }, { legalName: env(1), addressCity: env(2) })).resolves.toBeUndefined();
  });

  it("lets a plain contact save without any vault lookup", async () => {
    const db = vaultDb(null);
    await assertContactWrite(db, "t1", { legalName: "Novák s.r.o.", addressCity: "Brno" }, null);
    expect(plan).not.toHaveBeenCalled();
  });
});

describe("contact DTO", () => {
  it("accepts a sealed ZIP code and phone longer than their plain limits", () => {
    const r = createContactSchema.safeParse({ legalName: env(1), addressPostalCode: env(2), phone: env(3) });
    expect(r.success).toBe(true);
  });

  it("still limits the plain ZIP code and checks a plain e-mail", () => {
    expect(createContactSchema.safeParse({ legalName: "A", addressPostalCode: "12345678901" }).success).toBe(false);
    expect(createContactSchema.safeParse({ legalName: "A", email: "not-an-email" }).success).toBe(false);
    expect(createContactSchema.safeParse({ legalName: env(1), email: env(4) }).success).toBe(true);
  });
});

describe("server output of a sealed buyer", () => {
  const sealedContact = { legalName: env(1), addressStreet: env(2), addressCity: env(3), addressPostalCode: env(4), email: "a@b.cz", ico: "27604977" };

  it("counts a sealed buyer as a sealed document, from the contact or the snapshot", () => {
    const doc = { noteAbove: null, noteBelow: null, buyerSnapshot: null, buyerContactPerson: null };
    expect(documentIsSealed(doc, [{ description: "Konzultace" }], sealedContact)).toBe(true);
    expect(documentIsSealed(doc, [{ description: "Konzultace" }], { legalName: "Novák s.r.o." })).toBe(false);
    expect(documentIsSealed({ ...doc, buyerSnapshot: { legalName: env(5) } }, [], { legalName: "Novák s.r.o." })).toBe(true);
    expect(documentIsSealed({ ...doc, buyerContactPerson: env(6) }, [], { legalName: "Novák s.r.o." })).toBe(true);
  });

  it("prints the opened buyer once and never a sealed e-mail", () => {
    const opened = withOpenedBuyer(
      { buyerSnapshot: { legalName: env(1), addressCity: env(3), ico: "27604977" }, buyerContactPerson: env(7) },
      { ...sealedContact, email: env(8) },
      { buyer: { legalName: "Novák s.r.o.", addressStreet: "Dlouhá 5", addressCity: "Brno", addressPostalCode: "60200" }, buyerContactPerson: "Jan" },
    );
    const buyer = applyBuyerSnapshot(opened.contact as never, opened.invoice.buyerSnapshot) as Record<string, unknown>;
    expect(buyer).toMatchObject({ legalName: "Novák s.r.o.", addressCity: "Brno", addressStreet: "Dlouhá 5", ico: "27604977" });
    expect(opened.contact.email).toBeNull();
    expect(opened.invoice.buyerContactPerson).toBe("Jan");
  });

  it("refuses to print when the browser left a sealed buyer field out", () => {
    expect(() => withOpenedBuyer({ buyerSnapshot: null }, sealedContact, { buyer: { legalName: "Novák" } })).toThrow("texts_missing");
  });

  it("keeps ciphertext out of the portal URL, e-mail variables and greeting", () => {
    const link = clientPortalLinkOf(null, { portalToken: "tok", portalKey: "k3y", legalName: env(1) });
    expect(link).not.toContain("enc");
    expect(link).not.toContain("QQQQ");
    const vars = templateValues(undefined, undefined, { ...sealedContact, portalToken: null } as never);
    expect(vars.customer).toBe("");
    expect(emailCustomizationOf(emailPrefsOf(null), "invoice", undefined, env(1)).customerName).toBeUndefined();
  });

  it("exports and audits a sealed contact as the placeholder", () => {
    const row = redactSealedContact({ ...sealedContact, phone: env(9) });
    expect(row).toMatchObject({ legalName: SEALED_PLACEHOLDER, addressCity: SEALED_PLACEHOLDER, phone: SEALED_PLACEHOLDER, email: "a@b.cz", ico: "27604977" });
    expect(contactLabel(env(1))).toBe(SEALED_PLACEHOLDER);
  });
});
