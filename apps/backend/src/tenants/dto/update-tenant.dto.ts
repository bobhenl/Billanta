import { paymentMethodsSchema } from "../payment-methods";
import { publicProfileSchema } from "../public-profile";
import { templateVarsSchema } from "../template-vars";
import { VAT_STATUSES } from "@faktur/cz-compliance";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { emailPrefsSchema } from "../email-prefs";
import { invoiceFormPrefsSchema } from "../invoice-form-prefs";
import { enabledModulesSchema } from "../modules";

const text = (max: number) => z.string().trim().max(max).nullish();

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
    /** OSVČ monthly advances shown on the dashboard; a missing or null key = not set. */
    tax_advances: z
      .object({
        social: z.number().nonnegative().max(10_000_000).nullable(),
        health: z.number().nonnegative().max(10_000_000).nullable(),
        flat_tax: z.number().nonnegative().max(10_000_000).nullable(),
      })
      .partial()
      .strict(),
    address_street: text(200),
    address_city: text(100),
    address_postal_code: text(10),
    address_country: z.string().length(2),
    email: z.string().trim().email().max(320).nullish().or(z.literal("")),
    phone: text(32),
    website: text(200),
    registry_note: text(500),
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
  })
  .partial();

export class UpdateTenantDto extends createZodDto(updateTenantSchema) {}
