import { describe, expect, it } from "vitest";
import { createContactSchema } from "../contacts/dto/create-contact.dto";
import { buildDemoDataset, DEMO_KINDS } from "./dataset";
import { contactInput } from "./demo-transfer.service";

describe("contactInput", () => {
  it("turns a contact row into input the contacts form accepts", () => {
    const parsed = createContactSchema.safeParse(
      contactInput({
        id: "x",
        legal_name: "Stavby Novák s.r.o.",
        ico: "27074358",
        dic: "CZ27074358",
        email: "faktury@example.cz",
        address_street: "Dlouhá 12",
        address_city: "Brno",
        address_postal_code: "602 00",
        address_country: "CZ",
        is_vat_payer: true,
        is_person: false,
      }),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ legalName: "Stavby Novák s.r.o.", ico: "27074358", isVatPayer: true });
  });

  it("drops values the form would reject instead of losing the whole contact", () => {
    const input = contactInput({ id: "x", legal_name: "Jana", ico: "123", email: "not-an-email", is_vat_payer: null });
    expect(input).toMatchObject({ ico: undefined, email: undefined, isVatPayer: null });
    expect(createContactSchema.safeParse(input).success).toBe(true);
  });

  it("accepts every seeded demo contact", () => {
    for (const kind of DEMO_KINDS) {
      for (const c of buildDemoDataset(kind, new Date("2026-10-18T12:00:00Z")).contacts) {
        const row = { id: "x", legal_name: c.legalName, ico: c.ico, dic: c.dic, email: c.email, address_country: c.addressCountry };
        expect(createContactSchema.safeParse(contactInput(row)).success, `${kind}: ${c.legalName}`).toBe(true);
      }
    }
  });
});
