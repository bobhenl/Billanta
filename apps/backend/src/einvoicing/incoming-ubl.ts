import type { EInvoiceDocumentType } from "../../drizzle/schema";

/**
 * The fields of a received Peppol BIS 3.0 document that an expense needs.
 * A suggestion for a person to check, never booked as is.
 */
export interface IncomingExpenseDraft {
  documentType: EInvoiceDocumentType;
  documentNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  supplierName: string | null;
  supplierIco: string | null;
  supplierDic: string | null;
  /** Gross, as expenses store it; the net when the buyer self-assesses (reverse charge). */
  amount: string | null;
  vatRate: string | null;
  reverseCharge: boolean;
  variableSymbol: string | null;
  description: string | null;
  /** Things the reviewer should look at, as stable codes for the UI. */
  warnings: string[];
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

// Namespace prefixes differ between senders (cbc:, ubl:, none), so match on
// the local name only.
const elementRe = (name: string, flags = "") => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, flags);

function first(xml: string | undefined, name: string): string | null {
  if (!xml) return null;
  const m = elementRe(name).exec(xml);
  return m ? decode(m[1]) || null : null;
}

function all(xml: string, name: string): string[] {
  return [...xml.matchAll(elementRe(name, "g"))].map((m) => m[1]);
}

function block(xml: string, name: string): string | undefined {
  return elementRe(name).exec(xml)?.[1];
}

const amount = (s: string | null) => (s && /^-?\d+(\.\d+)?$/.test(s) ? Number(s).toFixed(2) : null);

/**
 * Reads an incoming UBL Invoice or CreditNote into an expense draft.
 *
 * Deliberately a small tolerant reader rather than a full UBL binding: the
 * provider has already validated the document against the Peppol rules
 * before delivering it, the exact XML is archived next to the draft, and a
 * person reviews every field before anything is booked. Anything we cannot
 * read cleanly becomes null plus a warning instead of a guess.
 */
export function parseIncomingUbl(xml: string): IncomingExpenseDraft {
  const warnings: string[] = [];
  const root = /<(?:[\w-]+:)?(Invoice|CreditNote)\b/.exec(xml.replace(/<\?xml[^>]*\?>/, ""))?.[1];
  if (!root) throw new Error("not_ubl_invoice");
  const documentType: EInvoiceDocumentType = root === "CreditNote" ? "credit_note" : "invoice";
  if (documentType === "credit_note") warnings.push("credit_note");

  // Header fields come before the first party block; reading them from there
  // keeps a party's or a line's own ID out of the way.
  const header = xml.split(/<(?:[\w-]+:)?AccountingSupplierParty\b/)[0];
  const supplier = block(xml, "AccountingSupplierParty");
  const supplierParty = supplier ? block(supplier, "Party") ?? supplier : undefined;

  const supplierName = first(block(supplierParty ?? "", "PartyLegalEntity"), "RegistrationName") ?? first(block(supplierParty ?? "", "PartyName"), "Name");
  const taxIds = all(supplierParty ?? "", "PartyTaxScheme").map((b) => first(b, "CompanyID")).filter((v): v is string => !!v);
  const supplierDic = taxIds.find((v) => /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(v.replace(/\s+/g, "").toUpperCase()))?.replace(/\s+/g, "").toUpperCase() ?? null;
  const legalId = first(block(supplierParty ?? "", "PartyLegalEntity"), "CompanyID")?.replace(/\s+/g, "") ?? null;
  const supplierIco = legalId && /^\d{8}$/.test(legalId) ? legalId : null;

  const totals = block(xml, "LegalMonetaryTotal");
  const gross = amount(first(totals, "TaxInclusiveAmount"));
  const net = amount(first(totals, "TaxExclusiveAmount"));

  // One expense has one rate. Take the rate with the largest base and say so
  // when there were several.
  const subtotals = all(block(xml, "TaxTotal") ?? "", "TaxSubtotal").map((b) => ({
    base: Number(first(b, "TaxableAmount") ?? "0"),
    rate: first(block(b, "TaxCategory"), "Percent"),
    category: first(block(b, "TaxCategory"), "ID"),
  }));
  const reverseCharge = subtotals.some((s) => s.category === "AE");
  const main = [...subtotals].sort((a, b) => b.base - a.base)[0];
  if (new Set(subtotals.map((s) => s.rate)).size > 1) warnings.push("mixed_vat_rates");
  let vatRate = main?.rate && /^\d+(\.\d+)?$/.test(main.rate) ? Number(main.rate).toFixed(2) : null;
  if (reverseCharge) {
    // The supplier charges 0 %; the rate to self-assess is the buyer's call.
    vatRate = null;
    warnings.push("reverse_charge_rate_needed");
  }

  const result: IncomingExpenseDraft = {
    documentType,
    documentNumber: first(header, "ID"),
    issueDate: first(header, "IssueDate"),
    // An invoice carries its due date in the header, a credit note (if at all) in PaymentMeans.
    dueDate: first(header, "DueDate") ?? first(block(xml, "PaymentMeans"), "PaymentDueDate"),
    currency: first(header, "DocumentCurrencyCode"),
    supplierName,
    supplierIco,
    supplierDic,
    amount: reverseCharge ? net : gross,
    vatRate,
    reverseCharge,
    variableSymbol: (() => {
      const id = first(block(xml, "PaymentMeans"), "PaymentID")?.replace(/\D/g, "");
      return id && id.length <= 10 ? id : null;
    })(),
    description: first(block(xml, documentType === "credit_note" ? "CreditNoteLine" : "InvoiceLine"), "Name"),
    warnings,
  };
  for (const [field, value] of [["documentNumber", result.documentNumber], ["issueDate", result.issueDate], ["amount", result.amount], ["supplierName", result.supplierName]] as const) {
    if (!value) warnings.push(`${field}_missing`);
  }
  return result;
}

/**
 * The Peppol participant ID (`scheme:id`) of a party in a UBL document, read
 * from the XML itself because that is what the network routes on.
 */
export function partyEndpoint(xml: string, party: "AccountingSupplierParty" | "AccountingCustomerParty"): string | null {
  const m = /<(?:[\w-]+:)?EndpointID\b[^>]*\bschemeID="([^"]+)"[^>]*>([^<]+)</.exec(block(xml, party) ?? "");
  return m ? `${m[1].trim()}:${decode(m[2])}` : null;
}
