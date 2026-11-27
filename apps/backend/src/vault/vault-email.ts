import { SEALED_BUYER_SNAPSHOT_FIELDS } from "@faktur/cz-compliance";
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
 * ciphertext, the item texts or (category "contacts") the buyer's name and address.
 */
export function documentIsSealed(
  invoice: { noteAbove: string | null; noteBelow: string | null } & DocumentBuyer,
  items: { description: string }[],
  contact?: BuyerFields | null,
): boolean {
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

/** The decrypted texts a member's browser sends for one PDF; they live only in this request's memory. */
export interface OpenedTexts {
  noteAbove?: string | null;
  noteBelow?: string | null;
  items?: { id: string; description: string }[];
  /** The buyer's name and address as printed (category "contacts"). */
  buyer?: Partial<Record<(typeof SEALED_BUYER_SNAPSHOT_FIELDS)[number], string | null>>;
  buyerContactPerson?: string | null;
}

/**
 * The document with its encrypted texts replaced by what the browser
 * decrypted, for printing it once. Only envelopes are replaced: a plain text
 * stays as stored, so the browser cannot rewrite what the server can read.
 * Throws `texts_missing` when an envelope has no text, rather than printing
 * ciphertext or a gap.
 */
export function withOpenedTexts<I extends { noteAbove: string | null; noteBelow: string | null }, L extends { id: string; description: string }>(
  invoice: I,
  items: L[],
  opened: OpenedTexts,
): { invoice: I; items: L[] } {
  const open = (stored: string | null, given: string | null | undefined): string | null => {
    if (!isSealed(stored)) return stored;
    if (typeof given !== "string") throw new Error("texts_missing");
    return given;
  };
  const byId = new Map((opened.items ?? []).map((i) => [i.id, i.description]));
  return {
    invoice: { ...invoice, noteAbove: open(invoice.noteAbove, opened.noteAbove), noteBelow: open(invoice.noteBelow, opened.noteBelow) },
    items: items.map((item) => ({ ...item, description: open(item.description, byId.get(item.id)) as string })),
  };
}

/** A real PDF, not anything else a client could upload in its place. */
export function looksLikePdf(content: Buffer): boolean {
  return content.length > 8 && content.subarray(0, 5).toString("latin1") === "%PDF-";
}

/**
 * The buyer of an encrypted document with its sealed name and address
 * replaced by what the browser decrypted, for printing once (like
 * `withOpenedTexts`). Fills the contact and the snapshot alike, so the
 * printed buyer is the same whichever one the renderer reads.
 */
export function withOpenedBuyer<I extends DocumentBuyer, C extends BuyerFields>(invoice: I, contact: C, opened: OpenedTexts): { invoice: I; contact: C } {
  const open = (stored: string | null | undefined, given: string | null | undefined): string | null | undefined => {
    if (!isSealed(stored)) return stored;
    if (typeof given !== "string") throw new Error("texts_missing");
    return given;
  };
  const given = opened.buyer ?? {};
  const openedContact: Record<string, unknown> = { ...contact };
  const snapshot = invoice.buyerSnapshot && typeof invoice.buyerSnapshot === "object" ? { ...(invoice.buyerSnapshot as Record<string, string | null>) } : null;
  for (const k of SEALED_BUYER_SNAPSHOT_FIELDS) {
    if (isSealed(contact[k])) openedContact[k] = open(contact[k], given[k]);
    if (snapshot && isSealed(snapshot[k])) snapshot[k] = open(snapshot[k], given[k]) ?? null;
  }
  // Nothing the browser cannot send back is printed: a sealed e-mail is left out.
  if (isSealed(contact.email)) openedContact.email = null;
  if (snapshot && isSealed(snapshot.email)) snapshot.email = null;
  return {
    invoice: { ...invoice, buyerSnapshot: snapshot ?? invoice.buyerSnapshot, buyerContactPerson: open(invoice.buyerContactPerson, opened.buyerContactPerson) ?? null },
    contact: openedContact as C,
  };
}
