import { describe, expect, it } from "vitest";
import { parseIncomingUbl, partyEndpoint } from "./incoming-ubl";

const invoice = (taxTotal: string, totals = "<cbc:TaxExclusiveAmount currencyID=\"EUR\">1000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID=\"EUR\">1230.00</cbc:TaxInclusiveAmount>") => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ID>FA-2027-0042</cbc:ID>
  <cbc:IssueDate>2027-01-04</cbc:IssueDate>
  <cbc:DueDate>2027-01-18</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="0245">2020123456</cbc:EndpointID>
    <cac:PartyName><cbc:Name>Dodávateľ</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>SK 2020123456</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Dodávateľ &amp; syn s.r.o.</cbc:RegistrationName><cbc:CompanyID>12345678</cbc:CompanyID></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Kupujúci</cbc:RegistrationName><cbc:CompanyID>87654321</cbc:CompanyID></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cbc:PaymentID>VS 20270042</cbc:PaymentID></cac:PaymentMeans>
  ${taxTotal}
  <cac:LegalMonetaryTotal>${totals}<cbc:PayableAmount currencyID="EUR">1230.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Konzultácie</cbc:Name></cac:Item></cac:InvoiceLine>
</Invoice>`;

const subtotal = (base: string, rate: string, cat = "S") =>
  `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">${base}</cbc:TaxableAmount><cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${rate}</cbc:Percent></cac:TaxCategory></cac:TaxSubtotal>`;

describe("parseIncomingUbl", () => {
  it("reads a standard invoice into a gross expense draft", () => {
    const d = parseIncomingUbl(invoice(`<cac:TaxTotal>${subtotal("1000.00", "23")}</cac:TaxTotal>`));
    expect(d).toEqual({
      documentType: "invoice",
      documentNumber: "FA-2027-0042",
      issueDate: "2027-01-04",
      dueDate: "2027-01-18",
      currency: "EUR",
      supplierName: "Dodávateľ & syn s.r.o.",
      supplierIco: "12345678",
      supplierDic: "SK2020123456",
      amount: "1230.00",
      vatRate: "23.00",
      reverseCharge: false,
      variableSymbol: "20270042",
      description: "Konzultácie",
      warnings: [],
    });
  });

  it("takes the rate with the largest base and warns on mixed rates", () => {
    const d = parseIncomingUbl(invoice(`<cac:TaxTotal>${subtotal("200.00", "5")}${subtotal("800.00", "23")}</cac:TaxTotal>`));
    expect(d.vatRate).toBe("23.00");
    expect(d.warnings).toContain("mixed_vat_rates");
  });

  it("uses the net amount and leaves the rate open for reverse charge", () => {
    const d = parseIncomingUbl(invoice(`<cac:TaxTotal>${subtotal("1000.00", "0", "AE")}</cac:TaxTotal>`, "<cbc:TaxExclusiveAmount>1000.00</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>1000.00</cbc:TaxInclusiveAmount>"));
    expect(d).toMatchObject({ reverseCharge: true, amount: "1000.00", vatRate: null });
    expect(d.warnings).toContain("reverse_charge_rate_needed");
  });

  it("handles credit notes and unprefixed elements", () => {
    const xml = `<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"><ID>D-1</ID><IssueDate>2027-02-01</IssueDate><AccountingSupplierParty><Party><PartyName><Name>X</Name></PartyName></Party></AccountingSupplierParty><LegalMonetaryTotal><TaxInclusiveAmount>-50</TaxInclusiveAmount></LegalMonetaryTotal></CreditNote>`;
    const d = parseIncomingUbl(xml);
    expect(d).toMatchObject({ documentType: "credit_note", documentNumber: "D-1", supplierName: "X", amount: "-50.00" });
    expect(d.warnings).toContain("credit_note");
  });

  it("flags what is missing instead of guessing", () => {
    const d = parseIncomingUbl("<Invoice><AccountingSupplierParty/></Invoice>");
    expect(d.warnings).toEqual(expect.arrayContaining(["documentNumber_missing", "issueDate_missing", "amount_missing", "supplierName_missing"]));
  });

  it("rejects anything that is not a UBL invoice", () => {
    expect(() => parseIncomingUbl("<Order/>")).toThrow("not_ubl_invoice");
  });
});

describe("partyEndpoint", () => {
  it("reads the participant ID a party is routed on", () => {
    const xml = invoice("");
    expect(partyEndpoint(xml, "AccountingSupplierParty")).toBe("0245:2020123456");
    expect(partyEndpoint(xml, "AccountingCustomerParty")).toBeNull();
  });
});
