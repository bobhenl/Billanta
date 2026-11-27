import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { isSealed, printedTexts } from "./sealed";
import { buyerTexts } from "./sealed-contacts";

type BuyerFields = { legalName?: string | null; addressStreet?: string | null; addressCity?: string | null; addressPostalCode?: string | null; email?: string | null };
type DocumentBuyer = { buyerSnapshot?: unknown; buyerContactPerson?: string | null };

/** `tenant_vaults.email_mode`: what sending an encrypted document does about its PDF. */
export const VAULT_EMAIL_MODES = ["link_now", "wait", "link_only"] as const;
export type VaultEmailMode = (typeof VAULT_EMAIL_MODES)[number];

/** The PDF a browser renders for a waiting e-mail; a few pages of pdf-lib output stay far below this. */
export const VAULT_PDF_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Whether the server cannot print the document: any of its printed texts is
 * ciphertext, the item texts or (category "contacts") the buyer's name and
 * address, or (category "amounts") its amounts.
 */
export function documentIsSealed(
  invoice: { noteAbove: string | null; noteBelow: string | null; encAmounts?: string | null } & DocumentBuyer,
  items: { description: string }[],
  contact?: BuyerFields | null,
): boolean {
  // Category "amounts" too: the server would print zeros where the amounts go.
  if (isSealed(invoice.encAmounts)) return true;
  return [...printedTexts(invoice, items), ...documentBuyerTexts(invoice, contact)].some((t) => isSealed(t));
}

/** The buyer texts the document prints: its snapshot laid over the contact, and the contact person. */
export function documentBuyerTexts(invoice: DocumentBuyer, contact: BuyerFields | null | undefined): (string | null | undefined)[] {
  const buyer = contact ? applyBuyerSnapshot(contact as never, invoice.buyerSnapshot) : null;
  return buyerTexts(buyer, invoice.buyerContactPerson ?? null);
}

export interface SealedSendPlan {
  /** Send the e-mail now, without the PDF the server cannot render. */
  sendNow: boolean;
  /** What waits for a member's browser: the whole e-mail, only its PDF, or nothing. */
  queue: "invoice" | "invoice_pdf" | null;
}

/**
 * Sending an encrypted document whose e-mail should carry its PDF. The
 * server never renders it (it would print ciphertext, or need the key), so
 * the e-mail either goes out with the link alone and the PDF follows from a
 * browser, waits whole for a browser, or goes out with the link only.
 * An unknown mode falls back to the default rather than to holding mail.
 */
export function sealedSendPlan(mode: string | null | undefined, wantsPdf: boolean): SealedSendPlan {
  if (!wantsPdf || mode === "link_only") return { sendNow: true, queue: null };
  if (mode === "wait") return { sendNow: false, queue: "invoice" };
  return { sendNow: true, queue: "invoice_pdf" };
}

/** A real PDF, not anything else a client could upload in its place. */
export function looksLikePdf(content: Buffer): boolean {
  return content.length > 8 && content.subarray(0, 5).toString("latin1") === "%PDF-";
}
