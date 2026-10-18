import { randomBytes } from "node:crypto";

/**
 * Links people send to their customers (/i/ invoice, /c/ client portal,
 * /d/ buyer details): a readable prefix plus a random key, e.g.
 * `novak-2026-0012-k3Fq9Xa2Lm7P`. Only the key after the last dash is
 * looked up, so the prefix is decoration: renaming the company, a new
 * invoice number or a mistyped prefix never breaks a link, and an invoice
 * number on its own (guessable) never opens anything. Links sent before
 * migration 0057 are bare UUIDs and keep working.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Exactly what newShortKey and gen_public_key() make; widen both together.
const KEY = /^[0-9A-Za-z]{12}$/;
const PREFIX = /^[0-9A-Za-z-]*$/;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** What a link segment points at: a legacy UUID token or a short key. */
export type LinkRef = { kind: "uuid"; value: string } | { kind: "key"; value: string };

/**
 * Reads the secret out of a link segment, or null when it can't be one.
 * A UUID is taken whole (its own dashes are not a prefix) and lower-cased
 * as Postgres prints it; otherwise the part after the last dash is the key.
 */
export function parseLinkSegment(segment: string): LinkRef | null {
  if (typeof segment !== "string" || segment.length > 120) return null;
  if (UUID.test(segment)) return { kind: "uuid", value: segment.toLowerCase() };
  const dash = segment.lastIndexOf("-");
  const key = segment.slice(dash + 1);
  if (!KEY.test(key) || !PREFIX.test(segment.slice(0, Math.max(dash, 0)))) return null;
  return { kind: "key", value: key };
}

export const isUuidToken = (value: string) => UUID.test(value);

/** A new key: 12 base62 characters (~71 bits) from the CSPRNG, without modulo bias (bytes >= 248 are redrawn). */
export function newShortKey(random: (n: number) => Buffer = randomBytes): string {
  let out = "";
  while (out.length < 12) {
    for (const byte of random(16)) {
      if (byte < 248 && out.length < 12) out += BASE62[byte % 62];
    }
  }
  return out;
}

/** `Faktura č. FV/2026/12` → `faktura-c-fv-2026-12`: lower case, no diacritics, a-z 0-9 and single dashes. */
export function slugify(value: string | null | undefined, max = 40): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, Math.max(0, max))
    .replace(/-+$/, "");
}

/** Settings → Faktury → Odkazy pro zákazníky: what goes in front of the key. */
export const PUBLIC_LINK_PREFIXES = ["number", "company_number", "none"] as const;
export type PublicLinkPrefix = (typeof PUBLIC_LINK_PREFIXES)[number];

/** The longest prefix we generate, so a link still fits on one line of a text message. */
export const PREFIX_MAX = 40;

/** The tenant columns a link needs; `invoiceFormPrefs.publicLinkPrefix` holds the setting. */
export type LinkTenant = { companyName?: string | null; publicProfile?: unknown; invoiceFormPrefs?: unknown };

export function publicLinkPrefixOf(prefs: unknown): PublicLinkPrefix {
  const value = (prefs as { publicLinkPrefix?: unknown } | null)?.publicLinkPrefix;
  return PUBLIC_LINK_PREFIXES.find((p) => p === value) ?? "number";
}

/** The company's public profile slug when it chose one, else its name. */
export function companySlugOf(tenant: LinkTenant | null | undefined): string {
  const slug = (tenant?.publicProfile as { slug?: unknown } | null)?.slug;
  return slugify(typeof slug === "string" && slug ? slug : tenant?.companyName, PREFIX_MAX);
}

/** The prefix for a document link. The number wins the space: it is what the customer recognises. */
export function documentPrefix(mode: PublicLinkPrefix, invoiceNumber: string | null | undefined, company: string): string {
  if (mode === "none") return "";
  const number = slugify(invoiceNumber, 24);
  if (mode === "number") return number;
  const room = PREFIX_MAX - (number ? number.length + 1 : 0);
  return [slugify(company, room), number].filter(Boolean).join("-");
}

const join = (prefix: string, key: string) => (prefix ? `${prefix}-${key}` : key);

/** The path segment after /i/ for an invoice; its UUID when it has no key (rows the migration has not reached). */
export function invoiceLinkOf(
  tenant: LinkTenant | null | undefined,
  invoice: { publicKey?: string | null; publicToken: string; invoiceNumber?: string | null },
): string {
  if (!invoice.publicKey) return invoice.publicToken;
  return join(documentPrefix(publicLinkPrefixOf(tenant?.invoiceFormPrefs), invoice.invoiceNumber, companySlugOf(tenant)), invoice.publicKey);
}

/** The path segment after /d/. A UUID token from before 0054 stays bare: a prefix would hide its dashes. */
export function buyerDetailsLinkOf(tenant: LinkTenant | null | undefined, invoice: { invoiceNumber?: string | null }, token: string): string {
  if (UUID.test(token)) return token;
  return join(documentPrefix(publicLinkPrefixOf(tenant?.invoiceFormPrefs), invoice.invoiceNumber, companySlugOf(tenant)), token);
}

/** The path segment after /c/ (the customer's name in front), or null when the portal is off. */
export function clientPortalLinkOf(
  tenant: LinkTenant | null | undefined,
  contact: { portalKey?: string | null; portalToken?: string | null; legalName?: string | null },
): string | null {
  if (!contact.portalToken) return null;
  if (!contact.portalKey) return contact.portalToken;
  const mode = publicLinkPrefixOf(tenant?.invoiceFormPrefs);
  return join(mode === "none" ? "" : slugify(contact.legalName, PREFIX_MAX), contact.portalKey);
}
