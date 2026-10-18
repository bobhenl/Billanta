import type {
  IsdocAddress,
  IsdocInvoiceInput,
  IsdocParty,
  VatRateType,
} from "@faktur/cz-compliance";
import * as schema from "../../drizzle/schema";
import type { InvoiceVatBreakdown } from "./invoice-total.util";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

/**
 * Maps a CZ VAT percentage to ISDOC's `VatRateType` category. Current CZ
 * rates (2024/2025, per zákona o DPH §47) are 21% (base), 12% (reduced), and
 * 0% (zero, e.g. exports/exempt supplies) — `reduced2` exists in the type
 * for SK's three-rate system but has no CZ equivalent today, so no CZ
 * percentage maps to it here. Any percentage that doesn't match one of the
 * known rates exactly (e.g. a typo'd or historical rate) falls back to
 * `base` for the CATEGORY only — `vatRatePercent` on the same line item
 * always carries the real, exact number regardless of which category
 * bucket it was sorted into, so no precision is lost for the actual
 * computed amounts.
 */
function vatRatePercentToCategory(percent: number): VatRateType {
  if (percent === 0) return "zero";
  if (percent === 12) return "reduced";
  if (percent === 21) return "base";
  return "base";
}

/** Maps this backend's flat address columns (shared shape between `contacts` and `tenants`) to ISDOC's `IsdocAddress`. */
function toIsdocAddress(row: {
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
}): IsdocAddress {
  return {
    street: row.addressStreet ?? "",
    city: row.addressCity ?? "",
    postalCode: row.addressPostalCode ?? "",
    countryCode: row.addressCountry,
  };
}

export function tenantToIsdocParty(tenant: TenantRow): IsdocParty {
  return {
    legalName: tenant.legalName,
    ico: tenant.ico ?? undefined,
    dic: tenant.dic ?? undefined,
    isVatPayer: tenant.dicVatPayer,
    address: toIsdocAddress(tenant),
  };
}

export function contactToIsdocParty(contact: ContactRow): IsdocParty {
  return {
    legalName: contact.legalName,
    ico: contact.ico ?? undefined,
    dic: contact.dic ?? undefined,
    isVatPayer: contact.isVatPayer ?? undefined,
    address: toIsdocAddress(contact),
    email: contact.email ?? undefined,
  };
}

/** `invoices.source`'s DB enum includes `"recurring"` and `"import"`, which have no equivalent in ISDOC's (narrower, optional) `source` field — omitted rather than misrepresented as `manual`. */
function toIsdocSource(source: InvoiceRow["source"]): IsdocInvoiceInput["source"] {
  return source === "recurring" || source === "import" || source === "profile_order" ? undefined : source;
}

/**
 * Assembles the full `IsdocInvoiceInput` (and, by extension, everything
 * `InvoicePdfService` also needs) from this backend's own row shapes —
 * the NestJS-side "finalize step" the type's own doc comment
 * (`packages/cz-compliance/src/isdoc-generator.ts`) says should exist.
 *
 * Requires the invoice to already carry `invoiceNumber`/`issueDate`/
 * `dueDate` (i.e. to have gone through `InvoicesService.issue` at least
 * once) — callers must check for that themselves; this function trusts its
 * input rather than re-validating issuance state.
 */
export function buildIsdocInvoiceInput(
  invoice: InvoiceRow,
  contact: ContactRow,
  tenant: TenantRow,
  lineItems: LineItemRow[],
  totals: InvoiceVatBreakdown,
): IsdocInvoiceInput {
  if (!invoice.invoiceNumber || !invoice.issueDate || !invoice.dueDate) {
    throw new Error(
      "buildIsdocInvoiceInput: invoice is missing invoiceNumber/issueDate/dueDate — has it been issued?",
    );
  }

  const isoIssueDate = invoice.issueDate.toISOString().slice(0, 10);
  const isoDueDate = invoice.dueDate.toISOString().slice(0, 10);

  return {
    invoiceNumber: invoice.invoiceNumber,
    variableSymbol: invoice.variableSymbol ?? undefined,
    issueDate: isoIssueDate,
    dueDate: isoDueDate,
    // DUZP defaults to the issue date (goods/services delivered at invoicing time).
    taxableSupplyDate: (invoice.taxableSupplyDate ?? invoice.issueDate).toISOString().slice(0, 10),
    currency: invoice.currency,
    // Same home-currency rule as the Pohoda export; SK suppliers keep EUR as local.
    localCurrency: tenant.addressCountry === "SK" ? "EUR" : "CZK",
    exchangeRate: invoice.exchangeRate ? Number(invoice.exchangeRate) : undefined,
    supplier: tenantToIsdocParty(tenant),
    customer: contactToIsdocParty(contact),
    lineItems: lineItems.map((item) => {
      const vatRatePercent = invoice.reverseCharge ? 0 : item.vatRate != null ? Number(item.vatRate) : 0;
      // ISDOC has no per-line discount field here; the discounted unit price
      // keeps line totals equal to the PDF's.
      const discount = Number(item.discountPercent ?? 0);
      return {
        description: item.description,
        quantity: Number(item.quantity),
        unitPriceWithoutVat: Number(item.unitPrice) * (1 - discount / 100),
        vatRate: vatRatePercentToCategory(vatRatePercent),
        vatRatePercent,
      };
    }),
    totals: {
      totalWithoutVat: totals.totalWithoutVat,
      totalVat: totals.totalVat,
      totalWithVat: totals.totalWithVat,
      vatRecapitulation: totals.byRate.map((entry) => ({
        vatRate: vatRatePercentToCategory(entry.vatRatePercent),
        vatRatePercent: entry.vatRatePercent,
        totalWithoutVat: entry.totalWithoutVat,
        vatAmount: entry.vatAmount,
        totalWithVat: entry.totalWithVat,
      })),
    },
    bankAccount:
      tenant.bankAccountIban || tenant.bankAccountNumber
        ? {
            accountNumber:
              tenant.bankAccountNumber && tenant.bankAccountBankCode
                ? `${tenant.bankAccountNumber}/${tenant.bankAccountBankCode}`
                : undefined,
            iban: tenant.bankAccountIban ?? undefined,
          }
        : undefined,
    source: toIsdocSource(invoice.source),
  };
}
