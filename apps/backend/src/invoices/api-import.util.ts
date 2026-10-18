import { normalizeCountry } from "../contacts/contacts-csv.util";
import type { ImportedInvoice } from "./invoice-import.util";
import type { BuyerSnapshot, SellerSnapshot } from "./party-snapshot";

/**
 * Helpers shared by the importers that read another system's API (BitFaktura,
 * Fakturoid). Each importer maps its own JSON; these keep the small parsing
 * rules (numbers, dates, tax numbers, bank accounts) the same for all of them.
 */

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** A number sent as a string or a number; null when empty or not a number. */
export const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** `YYYY-MM-DD` (optionally followed by a time) as a UTC day. */
export const date = (v: string | null | undefined): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
};

export const text = (v: string | null | undefined, max: number) => (v ? v.trim().slice(0, max) || null : null);

/** Free text as typed, with Windows line ends and outer blank lines removed. */
export const longText = (v: string | null | undefined, max: number) => text((v ?? "").replace(/\r\n?/g, "\n"), max);

export const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

const compactTaxNo = (v: string | null | undefined) => (v ?? "").replace(/[\s-]/g, "").toUpperCase();
export const isIco = (v: string) => /^\d{8}$/.test(v);
export const isVatId = (v: string) => /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(v);

/**
 * A buyer or client as a contact. BitFaktura keeps one tax number (`taxNo`):
 * a bare 8-digit number is a Czech IČO, with a country prefix a VAT ID.
 * Systems with separate fields pass `ico` and `dic` instead.
 */
export function contactFrom(c: {
  name: string;
  taxNo?: string | null;
  ico?: string | null;
  dic?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  postCode?: string | null;
  country?: string | null;
}): ImportedInvoice["customer"] {
  const taxNo = compactTaxNo(c.taxNo);
  const ico = compactTaxNo(c.ico);
  const dic = compactTaxNo(c.dic);
  // With no address at hand, people often typed the e-mail into the street or city
  // field on purpose, so the invoice still shows how to reach the buyer. Keep it
  // there as typed, and also use it as the contact's e-mail when there is none.
  const street = text(c.street, 255);
  const city = text(c.city, 255);
  const email = [c.email, street, city].map((v) => (v ?? "").trim()).find(isEmail) ?? null;
  const phone = text(c.phone, 64);
  return {
    legalName: c.name,
    ico: isIco(ico) ? ico : isIco(taxNo) ? taxNo : null,
    dic: isVatId(dic) ? dic : isVatId(taxNo) ? taxNo : null,
    email,
    addressStreet: street,
    addressCity: city,
    addressPostalCode: text(c.postCode, 10),
    addressCountry: normalizeCountry(c.country ?? undefined) ?? "CZ",
    ...(phone ? { phone } : {}),
  };
}

/**
 * The buyer block of one source invoice. Name and address exactly as typed;
 * IČO/DIČ only when the source has them.
 */
export function buyerSnapshotFrom(customer: ImportedInvoice["customer"], capturedAt: Date): BuyerSnapshot {
  const out: BuyerSnapshot = {
    legalName: customer.legalName,
    addressStreet: customer.addressStreet,
    addressCity: customer.addressCity,
    addressPostalCode: customer.addressPostalCode,
    addressCountry: customer.addressCountry,
  };
  if (customer.ico) out.ico = customer.ico;
  if (customer.dic) out.dic = customer.dic;
  if (customer.email) out.email = customer.email;
  return { ...out, capturedAt: capturedAt.toISOString(), source: "import" };
}

/**
 * A bank account as typed into the source: an IBAN, or a Czech `[prefix-]number/bank`.
 * Anything else is left out (the document then falls back to the current account).
 */
export function parseBankAccount(value: string | null | undefined): Pick<SellerSnapshot, "bankAccountNumber" | "bankAccountBankCode" | "bankAccountIban"> | null {
  const compact = (value ?? "").trim().replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return { bankAccountIban: compact };
  const m = /^((?:\d{1,6}-)?\d{2,10})\/(\d{4})$/.exec(compact);
  if (m) return { bankAccountNumber: m[1]!, bankAccountBankCode: m[2]! };
  return null;
}

/** The bytes when they are a PDF of a size we keep as an attachment; else null. */
export function asPdf(bytes: Buffer, maxBytes: number): Buffer | null {
  if (bytes.length === 0 || bytes.length > maxBytes || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return null;
  return bytes;
}
