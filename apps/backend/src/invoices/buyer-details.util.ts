import { parseVatId, VIES_COUNTRIES } from "@faktur/cz-compliance";
import { z } from "zod";
import type { BuyerDetailsOutcome } from "../../drizzle/schema";

/**
 * "Odběratel si doplní údaje sám": the rules behind the buyer-details link,
 * kept free of Nest and the database so each one can be unit-tested.
 */

/** Loose UUID shape check before a token ever reaches a `::uuid` cast (real access control = 122 random bits). */
export const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Statuses in which a document is still a draft; nothing else may be touched by the link. */
export const DRAFT_STATUSES = ["draft", "pending_review"] as const;
/** A credit note always belongs to an invoice that already has a customer. */
export const REQUESTABLE_TYPES = ["invoice", "proforma", "quote"] as const;

type RequestState = {
  status: string;
  documentType: string;
  buyerDetailsToken: string | null;
  buyerDetailsSubmittedAt: Date | null;
};

/** Why the user may not send this document for buyer details, or null when they may. */
export function requestBlock(invoice: Pick<RequestState, "status" | "documentType">): "not_draft" | "wrong_type" | null {
  if (!(DRAFT_STATUSES as readonly string[]).includes(invoice.status)) return "not_draft";
  if (!(REQUESTABLE_TYPES as readonly string[]).includes(invoice.documentType)) return "wrong_type";
  return null;
}

/**
 * Whether `token` may still submit details for this invoice: the exact open
 * token, a draft, nothing submitted yet. Returns the reason otherwise.
 */
export function submitBlock(invoice: RequestState | null | undefined, token: string): "not_found" | "closed" | "submitted" | null {
  if (!invoice || !TOKEN_PATTERN.test(token) || !invoice.buyerDetailsToken) return "not_found";
  if (invoice.buyerDetailsToken.toLowerCase() !== token.toLowerCase()) return "not_found";
  if (!(DRAFT_STATUSES as readonly string[]).includes(invoice.status)) return "closed";
  if (invoice.buyerDetailsSubmittedAt) return "submitted";
  return null;
}

const EU_VAT_COUNTRY: Record<string, string> = { GR: "EL" };

const compact = (v: string) => v.replace(/[\s.\-/]/g, "").toUpperCase();
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** What the customer submits on the public page (validated again here, never trusted from the browser). */
export const buyerDetailsSchema = z
  .object({
    isPerson: z.boolean().default(false),
    name: z.string().trim().min(2).max(200),
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => (v ? v.toLowerCase() : null))
      .pipe(z.string().email().nullable()),
    street: z.string().trim().min(2).max(200),
    city: z.string().trim().min(1).max(120),
    postalCode: z.string().trim().min(2).max(10),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    ico: optional(20),
    dic: optional(20),
  })
  .transform((v, ctx) => {
    const domestic = v.country === "CZ" || v.country === "SK";
    let ico = v.isPerson || !v.ico ? null : v.ico.replace(/\s+/g, "");
    let dic = v.isPerson || !v.dic ? null : compact(v.dic);
    if (ico) {
      if (!domestic) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ico"], message: "ico_foreign" });
        ico = null;
      } else if (!/^\d{6,8}$/.test(ico)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ico"], message: "ico_format" });
      } else {
        ico = ico.padStart(8, "0");
      }
    } else if (!v.isPerson && domestic) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ico"], message: "ico_required" });
    }
    if (dic) {
      const vatPrefix = EU_VAT_COUNTRY[v.country] ?? v.country;
      const eu = (VIES_COUNTRIES as readonly string[]).includes(vatPrefix);
      // "12345678" typed for a Czech company means CZ12345678, and so on in the EU.
      if (eu && /^\d/.test(dic)) dic = `${vatPrefix}${dic}`;
      const ok =
        v.country === "CZ"
          ? /^CZ\d{8,10}$/.test(dic)
          : v.country === "SK"
            ? /^SK\d{10}$/.test(dic)
            : eu
              ? parseVatId(dic)?.country === vatPrefix
              : // Outside the EU: any plain tax number that fits the column.
                /^[A-Z0-9]{4,14}$/.test(dic);
      if (!ok || dic.length > 14) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dic"], message: "dic_format" });
    }
    return {
      isPerson: v.isPerson,
      legalName: v.name.replace(/\s+/g, " "),
      email: v.email,
      addressStreet: v.street,
      addressCity: v.city,
      addressPostalCode: v.postalCode,
      addressCountry: v.country,
      ico,
      dic,
    };
  });

export type BuyerDetails = z.output<typeof buyerDetailsSchema>;

/** The contact columns the resolution below reads and writes. */
export type BuyerContact = {
  id: string;
  legalName: string;
  isPerson: boolean;
  email: string | null;
  ico: string | null;
  dic: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
};

export type ContactPatch = Partial<Omit<BuyerContact, "id">>;

export type ContactResolution =
  | { mode: "created"; contactId: null; values: Omit<BuyerContact, "id">; filled: string[]; conflicts: BuyerDetailsOutcome["conflicts"] }
  | { mode: "existing" | "filled"; contactId: string; patch: ContactPatch; filled: string[]; conflicts: BuyerDetailsOutcome["conflicts"] };

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s.,]+/g, " ")
    .trim()
    .toLowerCase();
const empty = (v: string | null | undefined) => !v || !v.trim();
const addressOf = (c: Pick<BuyerContact, "addressStreet" | "addressCity" | "addressPostalCode" | "addressCountry">) =>
  [c.addressStreet, [c.addressPostalCode, c.addressCity].filter(Boolean).join(" "), c.addressCountry].filter((p) => p && p.trim()).join(", ") || null;

/**
 * Where the customer's details go, without ever silently overwriting what
 * the company already saved:
 *  1. a saved contact with the same IČO (or DIČ) → that contact ("existing");
 *  2. otherwise the contact already on the draft, when it is the same party
 *     (same name, no different IČO/DIČ) → completed ("filled");
 *  3. otherwise a new contact ("created"); the draft's contact stays as it was.
 * In 1 and 2 only empty fields get a value; every field where the saved and
 * the submitted value differ is reported in `conflicts` and left unchanged.
 * A matched contact that is NOT the one on the draft is never written at
 * all (whoever holds the link could otherwise plant their e-mail on another
 * saved customer); what would have been filled is reported as a conflict.
 */
export function resolveBuyerContact(input: { attached: BuyerContact | null; match: BuyerContact | null; submitted: BuyerDetails }): ContactResolution {
  const { submitted } = input;
  const sameParty = (c: BuyerContact) =>
    norm(c.legalName) === norm(submitted.legalName) &&
    (empty(c.ico) || c.ico === submitted.ico) &&
    (empty(c.dic) || compact(c.dic!) === submitted.dic);
  const target = input.match ?? (input.attached && sameParty(input.attached) ? input.attached : null);
  if (!target) {
    return {
      mode: "created",
      contactId: null,
      values: {
        legalName: submitted.legalName,
        isPerson: submitted.isPerson,
        email: submitted.email,
        ico: submitted.ico,
        dic: submitted.dic,
        addressStreet: submitted.addressStreet,
        addressCity: submitted.addressCity,
        addressPostalCode: submitted.addressPostalCode,
        addressCountry: submitted.addressCountry,
      },
      filled: [],
      conflicts: [],
    };
  }

  // Only the contact the user put on the draft may be completed by the customer.
  const writable = !input.match || input.match.id === input.attached?.id;
  const patch: ContactPatch = {};
  const filled: string[] = [];
  const conflicts: BuyerDetailsOutcome["conflicts"] = [];
  const field = (key: "legalName" | "email" | "ico" | "dic", same: (a: string, b: string) => boolean) => {
    const saved = target[key];
    const next = submitted[key];
    if (empty(next)) return;
    if (empty(saved) && writable) {
      patch[key] = next!;
      filled.push(key);
    } else if (empty(saved)) {
      conflicts.push({ field: key, saved: null, submitted: next! });
    } else if (!same(saved!, next!)) {
      conflicts.push({ field: key, saved: saved!, submitted: next! });
    }
  };
  field("legalName", (a, b) => norm(a) === norm(b));
  field("email", (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase());
  field("ico", (a, b) => a.trim() === b);
  field("dic", (a, b) => compact(a) === b);

  // The address is one block: filled together into an empty one, never mixed.
  if (empty(target.addressStreet) && empty(target.addressCity) && !writable) {
    conflicts.push({ field: "address", saved: null, submitted: addressOf(submitted) });
  } else if (empty(target.addressStreet) && empty(target.addressCity)) {
    patch.addressStreet = submitted.addressStreet;
    patch.addressCity = submitted.addressCity;
    patch.addressPostalCode = submitted.addressPostalCode;
    patch.addressCountry = submitted.addressCountry;
    filled.push("address");
  } else {
    const differs =
      norm(target.addressStreet) !== norm(submitted.addressStreet) ||
      norm(target.addressCity) !== norm(submitted.addressCity) ||
      norm(target.addressPostalCode).replace(/ /g, "") !== norm(submitted.addressPostalCode).replace(/ /g, "") ||
      target.addressCountry !== submitted.addressCountry;
    if (differs) conflicts.push({ field: "address", saved: addressOf(target), submitted: addressOf(submitted) });
  }

  // "Private person" is a switch, not a value: it may flip only on a contact
  // that carries no company identifiers yet.
  if (target.isPerson !== submitted.isPerson) {
    if (empty(target.ico) && empty(target.dic) && writable) {
      patch.isPerson = submitted.isPerson;
      filled.push("isPerson");
    } else {
      conflicts.push({ field: "isPerson", saved: String(target.isPerson), submitted: String(submitted.isPerson) });
    }
  }

  return { mode: input.match ? "existing" : "filled", contactId: target.id, patch, filled, conflicts };
}

/**
 * Auto-issue runs only when the user asked for it and nothing needs their
 * eyes: no conflicting values, and the details did not move the draft over
 * to a different saved customer (whoever holds the link could otherwise get
 * a document issued to another company in the address book by typing its IČO).
 */
export function shouldAutoIssue(
  autoIssue: boolean,
  resolution: Pick<ContactResolution, "conflicts" | "mode" | "contactId">,
  attachedContactId: string | null,
): boolean {
  if (!autoIssue || resolution.conflicts.length > 0) return false;
  if (resolution.mode === "existing" && resolution.contactId !== attachedContactId) return false;
  return true;
}
