import type { GuestInvoiceInput } from "../guest-invoices/guest-invoices.service";
import { buyerSnapshotFrom, contactFrom } from "./api-import.util";
import type { ImportedInvoice, ImportSkip } from "./invoice-import.util";
import type { SellerSnapshot } from "./party-snapshot";

/**
 * The invoices a visitor made on the public generator (`/create-invoice`),
 * kept in their browser and sent once they have an account. They become
 * issued history like any other import: the same numbers, the customers as
 * contacts, the supplier block as typed on each PDF.
 */

/** The country of a CZ/SK tax number, else the company's own country. */
function countryOf(dic: string | null, home: string): string {
  const prefix = (dic ?? "").replace(/\s/g, "").slice(0, 2).toUpperCase();
  return prefix === "CZ" || prefix === "SK" ? prefix : home;
}

function sellerSnapshotOf(input: GuestInvoiceInput, home: string, capturedAt: Date): SellerSnapshot {
  const s = input.supplier;
  const out: SellerSnapshot = {
    companyName: s.name,
    legalName: s.name,
    dicVatPayer: input.vatPayer,
    addressStreet: s.street,
    addressCity: s.city,
    addressPostalCode: s.postalCode,
    addressCountry: home,
  };
  if (s.ico) out.ico = s.ico;
  if (s.dic) out.dic = s.dic;
  if (s.email) out.email = s.email;
  if (s.phone) out.phone = s.phone;
  if (s.iban) out.bankAccountIban = s.iban.replace(/\s/g, "").toUpperCase();
  if (s.bankAccountNumber) {
    out.bankAccountNumber = s.bankAccountNumber;
    if (s.bankCode) out.bankAccountBankCode = s.bankCode;
  }
  return { ...out, capturedAt: capturedAt.toISOString(), source: "import" };
}

/**
 * Maps the stored guest invoices onto the import shape. The same number
 * kept twice (the visitor fixed a typo and downloaded again) imports the
 * last copy only. A non-payer's VAT rates count as 0 and reverse charge
 * needs a VAT payer, exactly as the guest PDF showed them.
 */
export function mapGuestInvoices(inputs: GuestInvoiceInput[], home: string, now = new Date()): { invoices: ImportedInvoice[]; skipped: ImportSkip[] } {
  const skipped: ImportSkip[] = [];
  const byNumber = new Map<string, ImportedInvoice>();
  inputs.forEach((input, i) => {
    const line = i + 1;
    const earlier = byNumber.get(input.invoiceNumber);
    if (earlier) skipped.push({ line: earlier.line, number: earlier.invoiceNumber, reason: "duplicate_in_file" });
    const c = input.customer;
    const customer = contactFrom({ name: c.name, ico: c.ico, dic: c.dic, street: c.street, city: c.city, postCode: c.postalCode, country: countryOf(c.dic, home) });
    const reverseCharge = input.vatPayer && input.reverseCharge;
    const related = input.documentType === "credit_note" ? input.relatedInvoiceNumber : null;
    byNumber.delete(input.invoiceNumber);
    byNumber.set(input.invoiceNumber, {
      line,
      invoiceNumber: input.invoiceNumber,
      documentType: input.documentType,
      issueDate: input.issueDate,
      dueDate: input.dueDate ?? null,
      taxableSupplyDate: input.vatPayer ? (input.taxableSupplyDate ?? input.issueDate) : null,
      currency: input.currency,
      variableSymbol: input.variableSymbol ?? (input.invoiceNumber.replace(/\D/g, "").slice(-10) || null),
      status: "issued",
      paidAt: null,
      amountPaid: 0,
      customer,
      note: input.note,
      lines: input.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        vatRate: input.vatPayer ? item.vatRate : 0,
      })),
      reverseCharge,
      paymentMethod: input.paymentMethod,
      language: input.language,
      ...(related ? { internalNote: `K dokladu ${related}` } : {}),
      sellerSnapshot: sellerSnapshotOf(input, home, now),
      buyerSnapshot: buyerSnapshotFrom(customer, now),
    });
  });
  return { invoices: [...byNumber.values()].sort((a, b) => a.line - b.line), skipped: skipped.sort((a, b) => a.line - b.line) };
}

export type GuestSupplier = GuestInvoiceInput["supplier"];

type TenantFillRow = {
  ico: string | null;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  email: string | null;
  phone: string | null;
  bankAccountNumber: string | null;
  bankAccountBankCode: string | null;
  bankAccountIban: string | null;
};

export type GuestBusinessFill = Partial<TenantFillRow>;

/**
 * The company details the guest's supplier block may fill: only fields
 * still empty, the address and the bank account each only as a whole, so
 * nothing the user typed at signup is overwritten or mixed with the guest copy.
 */
export function guestBusinessFill(current: TenantFillRow, supplier: GuestSupplier | undefined): GuestBusinessFill {
  if (!supplier) return {};
  const out: GuestBusinessFill = {};
  const ico = (supplier.ico ?? "").replace(/\s/g, "");
  const dic = (supplier.dic ?? "").replace(/\s/g, "").toUpperCase();
  if (/^\d{6,10}$/.test(ico) && !current.ico) out.ico = ico;
  if (/^[A-Z]{2}[0-9A-Z]{2,12}$/.test(dic) && !current.dic) out.dic = dic;
  if ((supplier.street || supplier.city) && !current.addressStreet && !current.addressCity && !current.addressPostalCode) {
    if (supplier.street) out.addressStreet = supplier.street;
    if (supplier.city) out.addressCity = supplier.city;
    if (supplier.postalCode) out.addressPostalCode = supplier.postalCode;
  }
  if (supplier.email && !current.email) out.email = supplier.email;
  if (supplier.phone && !current.phone) out.phone = supplier.phone;
  if (!current.bankAccountNumber && !current.bankAccountIban) {
    if (supplier.bankAccountNumber && supplier.bankCode) {
      out.bankAccountNumber = supplier.bankAccountNumber;
      out.bankAccountBankCode = supplier.bankCode;
    }
    const iban = (supplier.iban ?? "").replace(/\s/g, "").toUpperCase();
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) out.bankAccountIban = iban;
  }
  return out;
}

/** The newest invoice's supplier block: the one the details are filled from. */
export function newestSupplier(inputs: GuestInvoiceInput[]): GuestSupplier | undefined {
  return inputs.reduce<GuestInvoiceInput | undefined>((a, b) => (!a || b.issueDate >= a.issueDate ? b : a), undefined)?.supplier;
}
