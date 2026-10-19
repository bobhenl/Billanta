import { cache } from 'react';
import { homeCurrencyOf, type HomeCurrency, type VatStatus } from '@faktur/cz-compliance';
import type { TemplateVar } from './template-vars';
import type { BankAccount } from './bank-account';
import { apiFetch, fetchMyCompanies } from './api-client';

export { ADVANCE_KINDS, vatStatusOf, type TaxAdvances } from './vat-status';
import type { TaxAdvances } from './vat-status';

/** `GET /api/v1/tenants/me` row (camelCase; the encrypted AI key is never returned). */
export type BuyerDetailsField = 'email' | 'phone' | 'ico' | 'dic';

export interface TenantSettings {
  id: string;
  companyName: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  /** Legacy, equal to vatStatus === 'payer'. */
  dicVatPayer: boolean;
  /** Optional so an older backend without it still renders (then derived from dicVatPayer, see vatStatusOf). */
  vatStatus?: VatStatus;
  /** OSVČ monthly advances by period for the dashboard deadlines (an old backend may still send the single-set object: read via normalizeTaxAdvances). */
  taxAdvances?: TaxAdvances;
  /** OSVČ: paušální režim yes / no; null or missing = not answered yet. */
  flatTaxRegime?: boolean | null;
  /** OSVČ: hlavní / vedlejší činnost; null or missing = not answered yet. */
  activityKind?: 'main' | 'secondary' | null;
  /** Fields a customer must fill in on a buyer-details link (0054); missing on an older backend. */
  buyerDetailsRequired?: BuyerDetailsField[];
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
  addressCountry: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  registryNote: string | null;
  /** ID datové schránky, lowercase; prefills the yearly přehled for ČSSZ. */
  dataBoxId?: string | null;
  bankAccountNumber: string | null;
  bankAccountBankCode: string | null;
  bankAccountIban: string | null;
  bankAccountSwift: string | null;
  defaultLocale: 'cs' | 'sk' | 'en';
  defaultDueDays: number;
  defaultPaymentMethod: string;
  defaultNoteBelow: string | null;
  /** Settings → Invoices; see `formPrefs()` in invoices/new/load.ts. */
  invoiceFormPrefs: Partial<import('@/app/[locale]/(dashboard)/invoices/new/types').InvoiceFormPrefs> | null;
  /** Settings → E-maily (camelCase as stored); see backend tenants/email-prefs.ts. */
  emailPrefs?: Partial<EmailPrefs> | null;
  /** Settings → Proměnné (lib/template-vars.ts). */
  templateVars?: TemplateVar[] | null;
  /** Settings → Způsoby úhrady (backend tenants/payment-methods.ts). */
  paymentMethods?: PaymentMethodDef[] | null;
  /** Settings → Veřejný profil (backend tenants/public-profile.ts); `{}` until first saved. */
  publicProfile?: Partial<PublicProfileSettings> | null;
  /** Settings → Modules; a missing key means enabled. */
  enabledModules?: Partial<Record<AppModule, boolean>> | null;
  subscriptionPlanId: string | null;
  subscriptionStatus: string | null;
  hasLogo: boolean;
  /** Demo playground (backend src/demo/); missing on an older backend. */
  isDemo?: boolean;
  demoKind?: import('./demo').DemoKind | null;
  demoExpiresAt?: string | null;
  demoAiCallsLeft?: number | null;
  createdAt: string;
}

export interface PublicProfileSettings {
  enabled: boolean;
  slug: string | null;
  tagline: string | null;
  about: string | null;
  /** `id` is assigned by the backend on save; `unitPrice`/`unit` are what an order puts on the draft. */
  services: { id?: string | null; title: string; description: string | null; price: string | null; unitPrice?: number | null; unit?: string | null }[];
  show: { email: boolean; phone: boolean; website: boolean; address: boolean; ico: boolean; logo: boolean };
  contactCta: boolean;
  /**
   * Orders from the profile: each lands as a draft for review. `customItems` lets customers add
   * unpriced lines; `prepay` shows payment details with a QR code after ordering.
   */
  orders: { enabled: boolean; customItems: boolean; prepay: boolean };
  /** "Kontaktovat": a message form whose messages land in the notifications. */
  contactForm: boolean;
  /** "Zobrazit v katalogu firem": opt-in listing on /directory and the town page of `town` (a municipality slug). */
  directory: { enabled: boolean; trade: string | null; town: string | null };
}

export interface PaymentMethodDef {
  id: string;
  label: string;
  /** Built-in method it behaves as (QR code, reports, POHODA export). */
  base: 'bank_transfer' | 'cash' | 'card' | 'cash_on_delivery' | 'other';
  instructions: string | null;
}

export interface EmailPrefs {
  fromName: string | null;
  replyTo: string | null;
  bccMe: boolean;
  invoiceSubject: string | null;
  invoiceMessage: string | null;
  reminderSubject: string | null;
  reminderMessage: string | null;
  signature: string | null;
  attachPdf: boolean;
  attachIsdoc: boolean;
  accent: string;
}

/** Stored prefs with the backend's defaults filled in (mirrors `emailPrefsOf`). */
export function emailPrefsOf(stored: Partial<EmailPrefs> | null | undefined): EmailPrefs {
  const s = stored ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    fromName: str(s.fromName),
    replyTo: str(s.replyTo),
    bccMe: s.bccMe === true,
    invoiceSubject: str(s.invoiceSubject),
    invoiceMessage: str(s.invoiceMessage),
    reminderSubject: str(s.reminderSubject),
    reminderMessage: str(s.reminderMessage),
    signature: str(s.signature),
    attachPdf: s.attachPdf !== false,
    attachIsdoc: s.attachIsdoc === true,
    accent: typeof s.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : '#4f46e5'
  };
}

export async function fetchTenant(): Promise<TenantSettings | null> {
  const rows = await apiFetch<TenantSettings[]>('/api/v1/tenants/me');
  return rows[0] ?? null;
}

/** The currency the company keeps its books in, from where it is registered (CZK when unknown). */
export const fetchHomeCurrency = cache(async (): Promise<HomeCurrency> => homeCurrencyOf((await fetchTenant().catch(() => null))?.addressCountry));

/** The signed-in user's role in the active company (same choice as `apiFetch`). */
export async function fetchMyRole(): Promise<string | null> {
  const { active } = await fetchMyCompanies();
  return active.role ?? null;
}

export const canManage = (role: string | null) => role === 'owner' || role === 'admin';

export { PERMISSION_AREAS, APP_MODULES } from './access';
export type { PermissionArea, PermissionLevel, AppModule } from './access';
import type { AppModule, PermissionArea, PermissionLevel } from './access';
import type { PlanSummary } from './plan';

/** `GET /api/v1/tenants/me/access`: the member's effective access and the company's enabled modules. */
export interface MyAccess {
  role: string;
  permissions: Record<PermissionArea, PermissionLevel>;
  modules: Record<AppModule, boolean>;
  /** Effective plan and trial; missing from an older backend. */
  plan?: PlanSummary | null;
}

// The dashboard layout and most pages both ask for it; one call per request.
export const fetchMyAccess = cache(async (): Promise<MyAccess> => apiFetch<MyAccess>('/api/v1/tenants/me/access'));

export { canWrite } from './access';
import { canWrite } from './access';

/** Server components: whether the member may change things in `area` (see `canWrite`; a failed access fetch allows). */
export async function fetchCanWrite(area: PermissionArea | null): Promise<boolean> {
  return canWrite(await fetchMyAccess().catch(() => null), area);
}

/** Dashboard sections to leave out of the navigation for this member/company. */
export function hiddenSections(access: MyAccess | null): string[] {
  if (!access) return [];
  const hidden: string[] = [];
  const p = access.permissions;
  if (p.invoices === 'none') hidden.push('invoices');
  if (p.contacts === 'none') hidden.push('contacts');
  if (p.expenses === 'none' || !access.modules.expenses) hidden.push('expenses');
  if (p.bank === 'none' || !access.modules.bank) hidden.push('bank');
  if (p.invoices === 'none' || !access.modules.time) hidden.push('time');
  if (!canManage(access.role)) hidden.push('billing');
  return hidden;
}

/**
 * Settings pages that save under the backend's `ADMIN_PREFIXES`
 * (apps/backend/src/tenancy/role-access.guard.ts): only owners and admins
 * can use them, so other roles don't get a form that fails on save.
 */
export const MANAGER_SETTINGS = [
  'company',
  'invoices',
  'numbering',
  'emails',
  'variables',
  'paymentMethods',
  'publicProfile',
  'modules',
  'team',
  'billing',
  'referrals',
  'backup',
  'import',
  'channels',
  'ai',
  'apiKeys'
] as const;
export type SettingsKey = (typeof MANAGER_SETTINGS)[number] | 'integrations' | 'exports';

/** Settings pages this member's role can't use (switched-off modules are not counted here). */
export function forbiddenSettings(access: MyAccess | null): Set<SettingsKey> {
  const out = new Set<SettingsKey>();
  if (!access || canManage(access.role)) return out;
  for (const key of MANAGER_SETTINGS) out.add(key);
  // The calendar feed is the only part of Integrace a non-admin can switch on, and the guard lets only accountants write there.
  if (access.role !== 'accountant') out.add('integrations');
  if (access.permissions.reports === 'none') out.add('exports');
  return out;
}

export type { BankAccount } from './bank-account';
export { bankAccountLine } from './bank-account';

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  return apiFetch<BankAccount[]>('/api/v1/tenants/me/bank-accounts');
}
