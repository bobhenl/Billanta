import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole, fetchTenant, type TenantSettings } from '@/lib/tenant';
import { PaymentMethodsEditor } from './payment-methods-editor';
import { CardPaymentsCard } from './card-payments-card';
import type { CardPaymentSettings } from '../actions';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.paymentMethods');
  return { title: t('title') };
}

/** Settings → Způsoby úhrady: the company's own payment methods offered in the invoice form. */
export default async function PaymentMethodsPage() {
  const locale = await getLocale();
  const t = await getTranslations('settings.paymentMethods');

  let tenant: TenantSettings | null;
  let role: string | null;
  let card: CardPaymentSettings | null;
  try {
    [tenant, role, card] = await Promise.all([
      fetchTenant(),
      fetchMyRole(),
      apiFetch<CardPaymentSettings>('/api/v1/tenants/me/card-payments').catch(() => null)
    ]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  if (!tenant) return <Banner tone="err" title={t('loadError')} className="mt-6" />;

  return (
    <div className="mx-auto max-w-4xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <CardPaymentsCard initial={card} readOnly={!canManage(role)} />
      <PaymentMethodsEditor initial={tenant.paymentMethods ?? []} readOnly={!canManage(role)} />
    </div>
  );
}
