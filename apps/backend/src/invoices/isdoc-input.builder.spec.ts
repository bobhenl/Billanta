import { generateIsdocXml, generateUblInvoiceXml } from "@faktur/cz-compliance";
import { describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import { computeVatBreakdown } from "./invoice-total.util";
import { buildIsdocInvoiceInput } from "./isdoc-input.builder";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

const tenant = {
  legalName: "Moje Firma s.r.o.",
  ico: "12345678",
  dic: "CZ12345678",
  dicVatPayer: true,
  addressStreet: "Hlavní 1",
  addressCity: "Praha",
  addressPostalCode: "11000",
  addressCountry: "CZ",
} as TenantRow;

const lineItems = [
  { description: "Konzultace", quantity: "2", unitPrice: "500", vatRate: "21", discountPercent: "0", sortOrder: 0 },
] as LineItemRow[];

function input(invoice: Partial<InvoiceRow>, contact: Partial<ContactRow> = {}) {
  return buildIsdocInvoiceInput(
    {
      invoiceNumber: "2026-0001",
      issueDate: new Date("2026-09-09"),
      dueDate: new Date("2026-09-23"),
      currency: "CZK",
      source: "manual",
      reverseCharge: false,
      documentType: "invoice",
      ...invoice,
    } as InvoiceRow,
    {
      legalName: "ACME s.r.o.",
      ico: "87654321",
      addressStreet: "Vedlejší 2",
      addressCity: "Brno",
      addressPostalCode: "60200",
      addressCountry: "CZ",
      ...contact,
    } as ContactRow,
    tenant,
    lineItems,
    computeVatBreakdown(lineItems),
  );
}

describe("buildIsdocInvoiceInput buyer contact person", () => {
  it("takes the document's contact person, not the contact's current one", () => {
    const built = input({ buyerContactPerson: "Jana Nováková" }, { contactPerson: "Někdo Jiný" });
    expect(built.customer.contactName).toBe("Jana Nováková");
    expect(generateIsdocXml(built)).toContain("<Contact><Name>Jana Nováková</Name>");
    expect(generateUblInvoiceXml(built)).toContain("<cac:Contact><cbc:Name>Jana Nováková</cbc:Name>");
  });

  it("leaves it out when the document has none", () => {
    const built = input({ buyerContactPerson: null }, { contactPerson: "Někdo Jiný" });
    expect(built.customer.contactName).toBeUndefined();
    expect(generateIsdocXml(built)).not.toContain("Někdo Jiný");
  });
});
