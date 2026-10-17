import { apiFetch } from '@/lib/api-client';
import { type BankAccount, bankAccountLine, fetchBankAccounts, fetchTenant } from '@/lib/tenant';
import { DEFAULT_SHOWN, OPTIONAL_FIELDS, PDF_ACCENTS, type AiSettings, type AnnualRate, type Contact, type DefaultItem, type DocLanguage, type FormDefaults, type InvoiceFormPrefs, type PaymentMethod } from './types';

const PAYMENT_METHODS: PaymentMethod[] = ['bank_transfer', 'cash', 'card', 'cash_on_delivery', 'other'];
const LANGUAGES: DocLanguage[] = ['cs', 'sk', 'en'];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything the form needs besides its starting point. All optional: the form works without each of them. */
export async function loadFormContext(): Promise<{ defaults: FormDefaults; ai: AiSettings | null; starred: Contact[] }> {
  const [tenant, ai, starred, accounts] = await Promise.all([
    fetchTenant().catch(() => null),
    apiFetch<AiSettings>('/api/v1/ai/settings').catch(() => null),
    apiFetch<Contact[]>('/api/v1/contacts/starred').catch(() => [] as Contact[]),
    fetchBankAccounts().catch(() => [] as BankAccount[])
  ]);
  const paymentMethod = PAYMENT_METHODS.find((m) => m === tenant?.defaultPaymentMethod) ?? 'bank_transfer';
  const language = LANGUAGES.find((l) => l === tenant?.defaultLocale) ?? 'cs';
  const prefs = formPrefs(tenant?.invoiceFormPrefs);
  const defaultContact = await loadContact(prefs.defaultContactId);
  return {
    defaults: {
      prefs,
      blank: {
        contact: defaultContact,
        currency: prefs.defaultCurrency,
        // Only an account that still exists; a deleted one falls back to the primary account.
        bankAccountId: accounts.some((a) => a.id === prefs.defaultBankAccountId) ? prefs.defaultBankAccountId : null,
        items: prefs.defaultItems,
        noteAbove: prefs.defaultNoteAbove
      },
      companyVars: (tenant?.templateVars ?? []).map((v) => ({ key: v.key, value: v.value })),
      vatPayer: Boolean(tenant?.dicVatPayer),
      quotesEnabled: tenant?.enabledModules?.quotes !== false,
      sellerCountry: tenant?.addressCountry || 'CZ',
      dueDays: tenant?.defaultDueDays ?? 14,
      paymentMethod,
      customPaymentMethods: (tenant?.paymentMethods ?? []).map((m) => ({ id: m.id, label: m.label, base: m.base, instructions: m.instructions })),
      noteBelow: tenant?.defaultNoteBelow ?? null,
      language,
      primaryAccount: tenant ? bankAccountLine({ accountNumber: tenant.bankAccountNumber, bankCode: tenant.bankAccountBankCode, iban: tenant.bankAccountIban }) || null : null,
      bankAccounts: accounts.map((a) => ({ id: a.id, label: a.label, line: bankAccountLine(a), currency: a.currency }))
    },
    ai,
    starred
  };
}

/** Stored prefs over the defaults; tolerant of an empty or partial jsonb. */
export function formPrefs(raw: Partial<InvoiceFormPrefs> | null | undefined): InvoiceFormPrefs {
  const show = { ...DEFAULT_SHOWN };
  for (const key of OPTIONAL_FIELDS) {
    const v = raw?.show?.[key];
    if (typeof v === 'boolean') show[key] = v;
  }
  return {
    show,
    customFieldLabels: Array.isArray(raw?.customFieldLabels) ? raw.customFieldLabels.filter((l) => typeof l === 'string') : [],
    defaultIssuePlace: raw?.defaultIssuePlace ?? null,
    defaultIssuedBy: raw?.defaultIssuedBy ?? null,
    pricesIncludeVat: raw?.pricesIncludeVat === true,
    pdfAccent: PDF_ACCENTS.find((c) => c === raw?.pdfAccent) ?? PDF_ACCENTS[0],
    pdfSecondLanguage: raw?.pdfSecondLanguage === 'cs' || raw?.pdfSecondLanguage === 'sk' || raw?.pdfSecondLanguage === 'en' ? raw.pdfSecondLanguage : null,
    remindersEnabled: raw?.remindersEnabled !== false,
    reminderIntervalDays: typeof raw?.reminderIntervalDays === 'number' ? raw.reminderIntervalDays : 7,
    reminderMax: typeof raw?.reminderMax === 'number' ? raw.reminderMax : 3,
    defaultCurrency: typeof raw?.defaultCurrency === 'string' ? raw.defaultCurrency : null,
    defaultBankAccountId: typeof raw?.defaultBankAccountId === 'string' ? raw.defaultBankAccountId : null,
    defaultContactId: typeof raw?.defaultContactId === 'string' ? raw.defaultContactId : null,
    defaultItems: Array.isArray(raw?.defaultItems) ? raw.defaultItems.filter(isDefaultItem) : [],
    defaultNoteAbove: typeof raw?.defaultNoteAbove === 'string' ? raw.defaultNoteAbove : null,
    exchangeRateMode: raw?.exchangeRateMode === 'none' ? 'none' : 'cnb_daily',
    // The old single setting "annual" meant the annual rate everywhere; now it only applies to reports.
    reportRateMode:
      raw?.reportRateMode === 'annual' || raw?.reportRateMode === 'daily'
        ? raw.reportRateMode
        : (raw?.exchangeRateMode as string | undefined) === 'annual'
          ? 'annual'
          : 'daily',
    annualRates: Array.isArray(raw?.annualRates) ? raw.annualRates.filter(isAnnualRate) : []
  };
}

function isAnnualRate(r: unknown): r is AnnualRate {
  const rate = r as Partial<AnnualRate> | null;
  return !!rate && typeof rate.year === 'number' && typeof rate.currency === 'string' && typeof rate.rate === 'number' && rate.rate > 0;
}

function isDefaultItem(i: unknown): i is DefaultItem {
  const item = i as Partial<DefaultItem> | null;
  return Boolean(item && typeof item.description === 'string' && typeof item.quantity === 'number' && typeof item.unitPrice === 'number');
}

export async function loadContact(id: string | null | undefined): Promise<Contact | null> {
  if (!id || !UUID.test(id)) return null;
  const rows = await apiFetch<Contact[]>(`/api/v1/contacts/${id}`).catch(() => [] as Contact[]);
  return rows[0] ?? null;
}
