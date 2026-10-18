import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Colour label palette (Invoice Ninja / Fakturoid style tagging of customers). */
export const CONTACT_COLORS = ["red", "orange", "amber", "green", "teal", "sky", "indigo", "violet", "pink", "slate"] as const;

export const createContactSchema = z.object({
  legalName: z.string().min(1),
  ico: z
    .string()
    .regex(/^\d{8}$/, "IČO must be 8 digits")
    .optional(),
  dic: z.string().optional(),
  // Optional: without it, this contact simply can't be emailed yet (see the
  // long comment on `contacts.email` in drizzle/schema.ts) — invoice-sending
  // and overdue-reminder emails check for this explicitly rather than
  // assuming it's set.
  email: z.string().email().optional(),
  phone: z.string().trim().max(40).nullish(),
  // "Kontaktní osoba": prefilled on new invoices for this customer and printed there.
  contactPerson: z.string().trim().max(255).nullish(),
  // Filled in when the contact is created from an ARES hit (invoice form's
  // customer search), so the invoice has a full address from the start.
  addressStreet: z.string().nullish(),
  addressCity: z.string().nullish(),
  addressPostalCode: z.string().max(10).nullish(),
  addressCountry: z.string().length(2).optional(),
  isVatPayer: z.boolean().nullish(),
  // Private individual — no IČO/DIČ expected.
  isPerson: z.boolean().optional(),
  aresVerified: z.boolean().optional(),
  color: z.enum(CONTACT_COLORS).nullish(),
  // Private, never printed on documents.
  internalNote: z.string().max(4000).nullish(),
});

export class CreateContactDto extends createZodDto(createContactSchema) {}
