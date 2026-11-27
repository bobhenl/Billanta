import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isSealed, sealableText } from "../../vault/sealed";

/** Colour label palette (Invoice Ninja / Fakturoid style tagging of customers). */
export const CONTACT_COLORS = ["red", "orange", "amber", "green", "teal", "sky", "indigo", "violet", "pink", "slate"] as const;

/**
 * A plain e-mail, or an `enc:v1:` envelope when the user chose to encrypt it
 * too (Důvěrný režim, "contacts"). The server never sends to a sealed one.
 */
export const contactEmail = z.string().refine((v) => (isSealed(v) ? sealableText(320).safeParse(v).success : z.string().email().safeParse(v).success), {
  message: "Invalid email",
});

export const createContactSchema = z.object({
  // Name, address, contact person, phone and note may arrive as envelopes
  // (src/vault/sealed-contacts.ts decides whether that is allowed).
  legalName: sealableText(1000).pipe(z.string().min(1)),
  ico: z
    .string()
    .regex(/^\d{8}$/, "IČO must be 8 digits")
    .optional(),
  dic: z.string().optional(),
  // Optional: without it, this contact simply can't be emailed yet (see the
  // long comment on `contacts.email` in drizzle/schema.ts) — invoice-sending
  // and overdue-reminder emails check for this explicitly rather than
  // assuming it's set.
  email: contactEmail.optional(),
  phone: sealableText(40).nullish(),
  // "Kontaktní osoba": prefilled on new invoices for this customer and printed there.
  contactPerson: sealableText(255).nullish(),
  // Filled in when the contact is created from an ARES hit (invoice form's
  // customer search), so the invoice has a full address from the start.
  addressStreet: sealableText(1000).nullish(),
  addressCity: sealableText(1000).nullish(),
  addressPostalCode: sealableText(10).nullish(),
  addressCountry: z.string().length(2).optional(),
  isVatPayer: z.boolean().nullish(),
  // Private individual — no IČO/DIČ expected.
  isPerson: z.boolean().optional(),
  aresVerified: z.boolean().optional(),
  color: z.enum(CONTACT_COLORS).nullish(),
  // Private, never printed on documents.
  internalNote: sealableText(4000).nullish(),
  // An IČO that is already saved: "return" hands back that contact (picking
  // the same ARES hit twice), "conflict" answers 409 so the caller can let
  // the user decide (offline drafts syncing later).
  onDuplicateIco: z.enum(["return", "conflict"]).optional(),
});

export class CreateContactDto extends createZodDto(createContactSchema) {}
