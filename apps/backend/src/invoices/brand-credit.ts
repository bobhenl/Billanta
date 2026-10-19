import * as schema from "../../drizzle/schema";
import { planSummary, type TenantPlanFields } from "../billing/plan-access";

/**
 * The "Vystaveno v Billantě" line under invoices (PDF, e-mail, public page):
 * every invoice a free company sends advertises the product to its customer,
 * the way Fakturoid and iDoklad sign theirs. A paid plan (or a trial) can
 * switch it off in Settings → Invoices; when the plan lapses it comes back.
 */
export const BRAND_NAME = "Billanta";

export type CreditLang = "cs" | "sk" | "en";
/** Where the reader saw the line, sent as `utm_content`. */
export type CreditPlacement = "pdf" | "email" | "page";

export const CREDIT_LABELS: Record<CreditLang, string> = {
  cs: `Vystaveno v aplikaci ${BRAND_NAME}`,
  sk: `Vystavené v aplikácii ${BRAND_NAME}`,
  en: `Made with ${BRAND_NAME}`,
};

/** Same check as apps/frontend/lib/referral.ts, so a broken code never ends up in a link. */
const REFERRAL_CODE = /^[A-Za-z0-9]{4,12}$/;

/** Whether the company asked to leave the line out (Settings → Invoices). */
export function brandCreditOptOut(prefs: unknown): boolean {
  return (prefs as { brandCredit?: unknown } | null)?.brandCredit === false;
}

/**
 * Free companies always show the line. A paid plan, a running trial or a
 * company from before plan limits may switch it off.
 */
export function showsBrandCredit(tenant: TenantPlanFields & { invoiceFormPrefs?: unknown }, now: Date = new Date()): boolean {
  if (!brandCreditOptOut(tenant.invoiceFormPrefs)) return true;
  const summary = planSummary(tenant, now);
  return summary.enforced && summary.plan === "free";
}

/** The public site, without a trailing slash. */
export function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://billanta.com").replace(/\/$/, "");
}

/**
 * Where the line links: the homepage in the invoice's language, tagged so
 * signups from it can be counted, with the issuer's referral code so they
 * also get the referral reward (middleware.ts sets the cookie from `ref`).
 */
export function brandCreditUrl(lang: CreditLang, placement: CreditPlacement, referralCode: string | null | undefined, site: string = siteUrl()): string {
  const params = new URLSearchParams({ utm_source: "invoice", utm_medium: "footer", utm_content: placement });
  if (referralCode && REFERRAL_CODE.test(referralCode)) params.set("ref", referralCode);
  return `${site}/${lang}?${params.toString()}`;
}

export interface BrandCredit {
  label: string;
  url: string;
}

/** The line to print, or null when the company switched it off. */
export function brandCreditFor(
  tenant: TenantPlanFields & { invoiceFormPrefs?: unknown; referralCode?: string | null },
  lang: CreditLang,
  placement: CreditPlacement,
  now: Date = new Date(),
): BrandCredit | null {
  if (!showsBrandCredit(tenant, now)) return null;
  return { label: CREDIT_LABELS[lang], url: brandCreditUrl(lang, placement, tenant.referralCode) };
}

/** The `tenants` columns `brandCreditFor` reads, for a Drizzle `select`. */
export const BRAND_CREDIT_TENANT_FIELDS = {
  planEnforced: schema.tenants.planEnforced,
  trialPlan: schema.tenants.trialPlan,
  trialStartedAt: schema.tenants.trialStartedAt,
  trialEndsAt: schema.tenants.trialEndsAt,
  prepaidPlan: schema.tenants.prepaidPlan,
  prepaidUntil: schema.tenants.prepaidUntil,
  subscriptionPlan: schema.tenants.subscriptionPlan,
  subscriptionStatus: schema.tenants.subscriptionStatus,
  isDemo: schema.tenants.isDemo,
  invoiceFormPrefs: schema.tenants.invoiceFormPrefs,
  referralCode: schema.tenants.referralCode,
};
