import { homeCurrencyOf } from '@faktur/cz-compliance';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { type BankAccount, bankAccountLine, canManage, fetchBankAccounts, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { vatStatusOf } from '@/lib/vat-status';
import { formPrefs, loadContact } from '../../invoices/new/load';
import { InvoiceFormSettings } from './invoice-form-settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.invoices');
  return { title: t('title') };
}

/** Settings → Invoices: tailor the invoice form to what this company actually fills in. */
export default async function InvoiceSettingsPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.invoices');

  let tenant: TenantSettings | null;
  let role: string | null;
  let accounts: BankAccount[];
  try {
    [tenant, role, accounts] = await Promise.all([fetchTenant(), fetchMyRole(), fetchBankAccounts().catch(() => [] as BankAccount[])]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  if (!tenant) return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  const prefs = formPrefs(tenant.invoiceFormPrefs);
  const defaultContact = await loadContact(prefs.defaultContactId);

  return (
    <div className="mx-auto max-w-3xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <InvoiceFormSettings
        prefs={prefs}
        company={{
          locale: tenant.defaultLocale,
          dueDays: tenant.defaultDueDays,
          paymentMethod: tenant.defaultPaymentMethod,
          noteBelow: tenant.defaultNoteBelow
        }}
        defaultContact={defaultContact}
        bankAccounts={accounts.map((a) => ({ id: a.id, label: a.label, line: bankAccountLine(a) }))}
        vatPayer={tenant.dicVatPayer}
        vatStatus={vatStatusOf(tenant)}
        home={homeCurrencyOf(tenant.addressCountry)}
        readOnly={!canManage(role)}
      />
    </div>
  );
}
