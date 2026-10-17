'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';

export type SettingsResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(path: string, method: string, body?: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    revalidatePath('/[locale]/(dashboard)/settings', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

/** Settings → Company. Keys are the backend's snake_case `UpdateTenantDto` fields. */
export async function updateCompany(patch: Record<string, string | number | boolean | null | Record<string, number | null>>) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', patch);
}

/** Settings → Modules: which parts of the app the dashboard shows. */
export async function updateModules(modules: Record<string, boolean>) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { enabled_modules: modules });
}

/**
 * Settings → Invoices: which optional fields the invoice form starts with,
 * preset labels and defaults. `company` carries the defaults that are
 * plain tenant columns (language, due days, payment method, note below),
 * saved in the same request.
 */
export async function updateInvoiceFormPrefs(
  prefs: {
  show: Record<string, boolean>;
  custom_field_labels: string[];
  default_issue_place: string | null;
  default_issued_by: string | null;
  prices_include_vat: boolean;
  pdf_accent: string;
  pdf_second_language: 'cs' | 'sk' | 'en' | null;
  reminders_enabled: boolean;
  reminder_interval_days: number;
  reminder_max: number;
  default_currency: string | null;
  default_bank_account_id: string | null;
  default_contact_id: string | null;
  default_items: { description: string; quantity: number; unit: string | null; unit_price: number; vat_rate: number | null }[];
  default_note_above: string | null;
  exchange_rate_mode: 'cnb_daily' | 'annual' | 'none';
  annual_rates: { year: number; currency: string; rate: number }[];
  },
  company?: {
    default_locale: 'cs' | 'sk' | 'en';
    default_due_days: number;
    default_payment_method: string;
    default_note_below: string | null;
  }
) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { ...company, invoice_form_prefs: prefs });
}

/** Settings → E-maily: sender, wording and attachments of the emails to customers. */
export async function updateEmailPrefs(prefs: {
  from_name: string | null;
  reply_to: string;
  bcc_me: boolean;
  invoice_subject: string | null;
  invoice_message: string | null;
  reminder_subject: string | null;
  reminder_message: string | null;
  signature: string | null;
  attach_pdf: boolean;
  attach_isdoc: boolean;
  accent: string;
}) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { email_prefs: prefs });
}

export async function updateTemplateVars(vars: { key: string; value: string; label: string | null }[]) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { template_vars: vars });
}

export type TeamRole = 'owner' | 'admin' | 'accountant' | 'viewer';

/** Per-area overrides of the role's defaults (null = role defaults); see lib/team-presets.ts. */
export type MemberPermissions = Partial<Record<'invoices' | 'contacts' | 'expenses' | 'bank' | 'reports', 'none' | 'read' | 'write'>> | null;

export async function inviteMember(email: string, role: Exclude<TeamRole, 'owner'>, permissions: MemberPermissions = null) {
  return run<{ id: string; email: string; role: string; acceptUrl: string; emailSent: boolean }>('/api/v1/team/invitations', 'POST', {
    email,
    role,
    permissions
  });
}

export async function revokeInvitation(id: string) {
  return run<unknown>(`/api/v1/team/invitations/${encodeURIComponent(id)}`, 'DELETE');
}

export async function changeMemberRole(id: string, role: Exclude<TeamRole, 'owner'>, permissions: MemberPermissions = null) {
  return run<unknown>(`/api/v1/team/members/${encodeURIComponent(id)}`, 'PATCH', { role, permissions });
}

export async function removeMember(id: string) {
  return run<unknown>(`/api/v1/team/members/${encodeURIComponent(id)}`, 'DELETE');
}

export interface BankAccountInput {
  label: string;
  account_number: string | null;
  bank_code: string | null;
  iban: string | null;
  swift: string | null;
  currency: string | null;
}

export async function saveBankAccount(id: string | null, input: BankAccountInput) {
  return id
    ? run<unknown>(`/api/v1/tenants/me/bank-accounts/${encodeURIComponent(id)}`, 'PUT', input)
    : run<unknown>('/api/v1/tenants/me/bank-accounts', 'POST', input);
}

export async function deleteBankAccount(id: string) {
  return run<unknown>(`/api/v1/tenants/me/bank-accounts/${encodeURIComponent(id)}`, 'DELETE');
}

export async function updatePaymentMethods(methods: { id: string; label: string; base: string; instructions: string | null }[]) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { payment_methods: methods });
}

export type NumberDocType = 'invoice' | 'proforma' | 'credit_note' | 'quote';

/** GET /tenants/me/number-formats: pattern, counters and the next number per document type. */
export interface NumberFormatsView {
  year: number;
  month: number;
  types: {
    type: NumberDocType;
    pattern: string | null;
    defaultPattern: string;
    reset: 'monthly' | 'yearly';
    lastYearly: number;
    lastMonthly: number;
    nextSequence: number | null;
    nextNumber: string | null;
  }[];
}

/** Settings → Číslování dokladů. A null pattern means the built-in one. */
export async function updateNumberFormats(input: {
  formats: Partial<Record<NumberDocType, string | null>>;
  nextNumbers: Partial<Record<NumberDocType, number>>;
}) {
  return run<NumberFormatsView>('/api/v1/tenants/me/number-formats', 'PUT', input);
}

export interface CardPaymentSettings {
  connected: boolean;
  enabled: boolean;
  accountName: string | null;
  mode: 'test' | 'live' | null;
  keyLast4: string | null;
}

/** Settings → Způsoby úhrady → Platba kartou: the company's own Stripe key (verified by the backend). */
export async function connectStripe(secretKey: string) {
  return run<CardPaymentSettings>('/api/v1/tenants/me/card-payments', 'PUT', { secretKey });
}

export async function setCardPaymentsEnabled(enabled: boolean) {
  return run<CardPaymentSettings>('/api/v1/tenants/me/card-payments/enabled', 'POST', { enabled });
}

export async function disconnectStripe() {
  return run<CardPaymentSettings>('/api/v1/tenants/me/card-payments', 'DELETE');
}

/** Settings → Veřejný profil. The backend answers 409 `slug_taken` when another company holds the slug. */
export async function updatePublicProfile(profile: import('@/lib/tenant').PublicProfileSettings) {
  return run<unknown>('/api/v1/tenants/me', 'PATCH', { public_profile: profile });
}

export async function checkProfileSlug(slug: string) {
  try {
    const data = await apiFetch<{ slug: string; available: boolean; reason: 'invalid' | 'reserved' | 'taken' | null }>(
      `/api/v1/tenants/me/public-profile/slug?slug=${encodeURIComponent(slug)}`
    );
    return { ok: true as const, data };
  } catch (error) {
    return { ok: false as const, error: backendMessage(error) };
  }
}
