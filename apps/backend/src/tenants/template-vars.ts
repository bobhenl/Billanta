import { z } from "zod";
import type * as schema from "../../drizzle/schema";
import { clientPortalLinkOf, invoiceLinkOf, type LinkTenant } from "../public-links/public-link";

/**
 * Settings → Proměnné: `{placeholders}` usable in the customer emails
 * (subject, text, signature) and in the notes printed on documents
 * (note above/below the items, registry note).
 *
 * Two kinds:
 * - built-in ones filled from the company, the document and the customer
 *   (`BUILTIN_VARS`) — always available;
 * - the company's own (`tenants.template_vars`, jsonb array of
 *   `{ key, value, label }`), e.g. `{obchodni_podminky}` → a URL, typed once
 *   and reused everywhere. A built-in name always wins, so a custom
 *   variable can never change what `{number}` means.
 */
export const BUILTIN_VARS = [
  "number",
  "amount",
  "base",
  "vat",
  "paid",
  "remaining",
  "net",
  "tax",
  "social",
  "health",
  "insurance",
  "due_date",
  "issue_date",
  "vs",
  "customer",
  "customer_ico",
  "link",
  "company",
  "ico",
  "dic",
  "company_email",
  "phone",
  "web",
  "address",
  "bank_account",
  "iban",
  "today",
  "year",
  "reminder_no",
] as const;

export const MAX_TEMPLATE_VARS = 30;

export const templateVarsSchema = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .regex(/^[a-z][a-z0-9_]{0,31}$/, "key: lowercase letters, digits and _ (max 32)")
        .refine((k) => !(BUILTIN_VARS as readonly string[]).includes(k), "key: clashes with a built-in variable"),
      value: z.string().max(1000),
      label: z.string().trim().max(60).nullish(),
    }),
  )
  .max(MAX_TEMPLATE_VARS)
  .refine((vars) => new Set(vars.map((v) => v.key)).size === vars.length, "keys must be unique")
  .transform((vars) => vars.map((v) => ({ key: v.key, value: v.value, label: v.label || null })));

export type TemplateVar = z.output<typeof templateVarsSchema>[number];

/** Stored vars, tolerant of an older or hand-edited shape. */
export function templateVarsOf(stored: unknown): TemplateVar[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const { key, value, label } = v as Record<string, unknown>;
    if (typeof key !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(key) || typeof value !== "string") return [];
    return [{ key, value, label: typeof label === "string" && label ? label : null }];
  });
}

type TenantRow = typeof schema.tenants.$inferSelect;
type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;

const czDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("cs-CZ", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Prague" }) : "";

/** The invoice's client page; `link` comes from `invoiceLinkOf` (public-links/public-link.ts). */
export function portalUrlOf(link: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://faktur.app").replace(/\/$/, "");
  return `${siteUrl}/i/${link}`;
}

/** The customer's portal with all their documents, see `/c/:token`; `link` comes from `clientPortalLinkOf`. */
export function clientPortalUrlOf(link: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://faktur.app").replace(/\/$/, "");
  return `${siteUrl}/c/${link}`;
}

/**
 * Every value a template can use for this company (and, when given, this
 * document and customer): the company's own variables first, built-ins on
 * top. `amount` is left to the caller — it needs the computed totals.
 */
export function templateValues(
  tenant: (Pick<TenantRow, "companyName" | "ico" | "dic" | "email" | "phone" | "website" | "addressStreet" | "addressCity" | "addressPostalCode" | "bankAccountNumber" | "bankAccountBankCode" | "bankAccountIban" | "templateVars"> & LinkTenant) | undefined,
  invoice?: (Pick<InvoiceRow, "invoiceNumber" | "variableSymbol" | "issueDate" | "dueDate" | "publicToken"> & { publicKey?: string | null }) | null,
  contact?: (Pick<ContactRow, "legalName" | "ico"> & { portalToken?: string | null; portalKey?: string | null }) | null,
  now: Date = new Date(),
): Record<string, string> {
  const own = Object.fromEntries(templateVarsOf(tenant?.templateVars).map((v) => [v.key, v.value]));
  const address = [tenant?.addressStreet, [tenant?.addressPostalCode, tenant?.addressCity].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const builtins: Record<string, string> = {
    company: tenant?.companyName ?? "",
    ico: tenant?.ico ?? "",
    dic: tenant?.dic ?? "",
    company_email: tenant?.email ?? "",
    phone: tenant?.phone ?? "",
    web: tenant?.website ?? "",
    address,
    bank_account: tenant?.bankAccountNumber ? `${tenant.bankAccountNumber}${tenant.bankAccountBankCode ? `/${tenant.bankAccountBankCode}` : ""}` : "",
    iban: tenant?.bankAccountIban ?? "",
    today: czDate(now),
    year: String(now.getFullYear()),
  };
  if (invoice) {
    Object.assign(builtins, {
      number: invoice.invoiceNumber ?? "",
      vs: invoice.variableSymbol ?? "",
      issue_date: czDate(invoice.issueDate),
      due_date: czDate(invoice.dueDate),
      link: portalUrlOf(invoiceLinkOf(tenant, invoice)),
    });
  }
  if (contact) {
    const portal = clientPortalLinkOf(tenant, contact);
    Object.assign(builtins, { customer: contact.legalName, customer_ico: contact.ico ?? "", portal_link: portal ? clientPortalUrlOf(portal) : "" });
  }
  return { ...own, ...builtins };
}
