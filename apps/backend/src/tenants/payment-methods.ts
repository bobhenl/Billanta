import { z } from "zod";

/**
 * Settings → Způsoby úhrady: the company's own payment methods
 * (`tenants.payment_methods`, jsonb array), e.g. "PayPal", "Zápočet",
 * "Stripe odkaz". Each one maps onto a built-in `base` method — that keeps
 * reports, filters and the QR payment logic working — and carries the
 * label and instructions printed on the document instead of the built-in
 * name. The invoice stores a copy (`payment_method_label`,
 * `payment_instructions`), so editing or deleting a method later never
 * changes documents already issued.
 */
export const BASE_PAYMENT_METHODS = ["bank_transfer", "cash", "card", "cash_on_delivery", "other"] as const;
export const MAX_PAYMENT_METHODS = 20;

export const paymentMethodsSchema = z
  .array(
    z.object({
      id: z
        .string()
        .trim()
        .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
      label: z.string().trim().min(1).max(60),
      base: z.enum(BASE_PAYMENT_METHODS).default("other"),
      instructions: z.string().trim().max(500).nullish(),
    }),
  )
  .max(MAX_PAYMENT_METHODS)
  .refine((list) => new Set(list.map((m) => m.id)).size === list.length, "ids must be unique")
  .transform((list) => list.map((m) => ({ id: m.id, label: m.label, base: m.base, instructions: m.instructions || null })));

export type PaymentMethodDef = z.output<typeof paymentMethodsSchema>[number];

/** Stored methods, tolerant of an older or hand-edited shape. */
export function paymentMethodsOf(stored: unknown): PaymentMethodDef[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((m) => {
    if (!m || typeof m !== "object") return [];
    const { id, label, base, instructions } = m as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string" || !label.trim()) return [];
    return [
      {
        id,
        label,
        base: (BASE_PAYMENT_METHODS as readonly string[]).includes(base as string) ? (base as PaymentMethodDef["base"]) : "other",
        instructions: typeof instructions === "string" && instructions ? instructions : null,
      },
    ];
  });
}
