import { z } from "zod";

/**
 * Settings → E-maily: how the invoice and reminder emails to customers look.
 * Stored as `tenants.email_prefs` (jsonb). Subjects/messages are templates
 * with `{placeholders}` (see `EMAIL_PLACEHOLDERS`); empty = built-in text.
 * The sending address itself stays the platform's verified `EMAIL_FROM`
 * (Resend only sends from verified domains) — the company picks the display
 * name and where replies go.
 */
export const EMAIL_PLACEHOLDERS = ["number", "amount", "due_date", "company", "customer", "link", "reminder_no"] as const;

const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const emailPrefsSchema = z
  .object({
    from_name: optionalText(80),
    reply_to: z.string().trim().email().max(200).or(z.literal("")).nullish(),
    bcc_me: z.boolean().default(false),
    invoice_subject: optionalText(200),
    invoice_message: optionalText(2000),
    reminder_subject: optionalText(200),
    reminder_message: optionalText(2000),
    signature: optionalText(500),
    attach_pdf: z.boolean().default(true),
    attach_isdoc: z.boolean().default(false),
    /** Button colour in the email; any #rrggbb. */
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#4f46e5"),
  })
  .transform((p) => ({
    fromName: p.from_name || null,
    replyTo: p.reply_to || null,
    bccMe: p.bcc_me,
    invoiceSubject: p.invoice_subject || null,
    invoiceMessage: p.invoice_message || null,
    reminderSubject: p.reminder_subject || null,
    reminderMessage: p.reminder_message || null,
    signature: p.signature || null,
    attachPdf: p.attach_pdf,
    attachIsdoc: p.attach_isdoc,
    accent: p.accent,
  }));

export type EmailPrefs = z.output<typeof emailPrefsSchema>;

/** Sender, wording and colour shared by the invoice and reminder emails (no attachments). */
export function emailCustomizationOf(
  prefs: EmailPrefs,
  kind: "invoice" | "reminder",
  tenant: { companyName: string; email: string | null } | undefined,
  customerName: string | undefined,
  vars?: Record<string, string>,
) {
  return {
    vars,
    subject: kind === "invoice" ? prefs.invoiceSubject : prefs.reminderSubject,
    message: kind === "invoice" ? prefs.invoiceMessage : prefs.reminderMessage,
    signature: prefs.signature,
    fromName: prefs.fromName ?? tenant?.companyName ?? null,
    replyTo: prefs.replyTo ?? tenant?.email ?? null,
    bcc: prefs.bccMe ? (tenant?.email ?? null) : null,
    accent: prefs.accent,
    companyName: tenant?.companyName,
    customerName,
  };
}

/** Stored prefs with defaults for tenants that never saved them (or saved an older shape). */
export function emailPrefsOf(stored: unknown): EmailPrefs {
  const s = (stored ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    fromName: str(s.fromName),
    replyTo: str(s.replyTo),
    bccMe: bool(s.bccMe, false),
    invoiceSubject: str(s.invoiceSubject),
    invoiceMessage: str(s.invoiceMessage),
    reminderSubject: str(s.reminderSubject),
    reminderMessage: str(s.reminderMessage),
    signature: str(s.signature),
    attachPdf: bool(s.attachPdf, true),
    attachIsdoc: bool(s.attachIsdoc, false),
    accent: typeof s.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : "#4f46e5",
  };
}

/** Replaces `{number}`, `{amount}`… — unknown placeholders stay as typed. */
export function fillTemplate(template: string, values: Partial<Record<string, string>>): string {
  return template.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values as Record<string, string>)[key] ?? "" : match,
  );
}
