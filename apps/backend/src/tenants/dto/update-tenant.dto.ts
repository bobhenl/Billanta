import { paymentMethodsSchema } from "../payment-methods";
import { publicProfileSchema } from "../public-profile";
import { templateVarsSchema } from "../template-vars";
import {
  czHealthInsurer,
  czSocialOffice,
  czTaxOffice,
  czTaxWorkplace,
  MONTH_KEY_PATTERN,
  TAX_ADVANCE_MAX,
  VAT_STATUSES,
} from "@faktur/cz-compliance";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { emailPrefsSchema } from "../email-prefs";
import { invoiceFormPrefsSchema } from "../invoice-form-prefs";
import { enabledModulesSchema } from "../modules";
import { BUYER_DETAILS_FIELDS } from "../../invoices/buyer-details.util";

const text = (max: number) => z.string().trim().max(max).nullish();

const advanceAmount = z.number().nonnegative().max(TAX_ADVANCE_MAX).nullish();
const yearInRange = (m: string) => Number(m.slice(0, 4)) >= 2000 && Number(m.slice(0, 4)) <= 2100;
/** "YYYY-MM-DD" of a real day (no 2026-02-30). */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return yearInRange(d) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
  }, "invalid_date");

/**
 * OSVČ monthly advances with history: each entry applies from its month
 * ("YYYY-MM") on; a missing or null kind keeps the earlier amount, 0 is a real
 * amount. The whole list is replaced on save; months must be unique.
 */
export const taxAdvancesSchema = z
  .array(
    z
      .object({
        from: z.string().regex(MONTH_KEY_PATTERN).refine(yearInRange, "year_out_of_range"),
        social: advanceAmount,
        health: advanceAmount,
        flat_tax: advanceAmount,
      })
      .strict(),
  )
  .max(240)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((entry, i) => {
      if (seen.has(entry.from)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "from"], message: "duplicate_from" });
      seen.add(entry.from);
    });
  });

/** Settings → Company: the issuer block printed on every document, bank details and invoice defaults. */
export const updateTenantSchema = z
  .object({
    company_name: z.string().trim().min(1).max(200),
    legal_name: z.string().trim().min(1).max(200),
    ico: z
      .string()
      .regex(/^\d{8}$/)
      .nullish(),
    dic: z
      .string()
      .regex(/^[A-Z]{2}\d{8,10}$/)
      .nullish(),
    /** Legacy: true = payer, false = non_payer (an identified person stays identified). `vat_status` wins when both are sent. */
    dic_vat_payer: z.boolean(),
    vat_status: z.enum(VAT_STATUSES),
    /** OSVČ monthly advances by period, shown on the dashboard deadlines (see taxAdvancesSchema). */
    tax_advances: taxAdvancesSchema,
    /** OSVČ: paušální režim yes / no, null = not answered (decides the suggested minimums and default deadlines). */
    flat_tax_regime: z.boolean().nullable(),
    /** OSVČ: hlavní or vedlejší činnost, null = not answered. */
    activity_kind: z.enum(["main", "secondary"]).nullable(),
    /** The days of the vedlejší činnost, null = open on that side (from ≤ to is checked against the stored row in the service). */
    secondary_activity_from: calendarDay.nullable(),
    secondary_activity_to: calendarDay.nullable(),
    address_street: text(200),
    address_city: text(100),
    address_postal_code: text(10),
    address_country: z.string().length(2),
    /** The tax country (ISO code). Only an active one, and only until the first issued invoice (country-change.ts). */
    country: z.string().regex(/^[A-Za-z]{2}$/),
    email: z.string().trim().email().max(320).nullish().or(z.literal("")),
    phone: text(32),
    website: text(200),
    registry_note: text(500),
    /** ID datové schránky; boxes are case-insensitive, stored lowercase. Empty string clears it. */
    data_box_id: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^([a-z0-9]{7})?$/)
      .nullish(),
    // Codes from the official lists only (cz-tax-offices / cz-social-offices):
    // EPO and ČSSZ reject anything else. The office/pracoviště pair is
    // checked in TenantsService.update against the stored values.
    tax_office: z.number().int().refine((c) => czTaxOffice(c) !== null, "unknown_tax_office").nullish(),
    tax_workplace: z.number().int().refine((c) => czTaxWorkplace(c) !== null, "unknown_tax_workplace").nullish(),
    health_insurer: z
      .string()
      .refine((c) => c === "" || czHealthInsurer(c) !== null, "unknown_health_insurer")
      .nullish(),
    social_office: z.number().int().refine((c) => czSocialOffice(c) !== null, "unknown_social_office").nullish(),
    residence_street: text(200),
    residence_city: text(100),
    residence_postal_code: text(10),
    filing_email: z.string().trim().email().max(320).nullish().or(z.literal("")),
    filing_phone: text(32),
    bank_account_number: z
      .string()
      .regex(/^(\d{1,6}-)?\d{2,10}$/)
      .nullish()
      .or(z.literal("")),
    bank_account_bank_code: z
      .string()
      .regex(/^\d{4}$/)
      .nullish()
      .or(z.literal("")),
    bank_account_iban: z
      .string()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().regex(/^([A-Z]{2}\d{2}[A-Z0-9]{10,30})?$/))
      .nullish(),
    bank_account_swift: z
      .string()
      .regex(/^([A-Z0-9]{8}|[A-Z0-9]{11})?$/)
      .nullish(),
    default_locale: z.enum(["cs", "sk", "en"]),
    default_due_days: z.coerce.number().int().min(0).max(365),
    default_payment_method: z.enum(["bank_transfer", "cash", "card", "cash_on_delivery", "other"]),
    default_note_below: text(2000),
    invoice_form_prefs: invoiceFormPrefsSchema,
    email_prefs: emailPrefsSchema,
    template_vars: templateVarsSchema,
    payment_methods: paymentMethodsSchema,
    public_profile: publicProfileSchema,
    enabled_modules: enabledModulesSchema,
    // Default required fields on a buyer-details link (see BuyerDetailsService.request).
    buyer_details_required: z.array(z.enum(BUYER_DETAILS_FIELDS)).max(4),
  })
  .partial();

export class UpdateTenantDto extends createZodDto(updateTenantSchema) {}
