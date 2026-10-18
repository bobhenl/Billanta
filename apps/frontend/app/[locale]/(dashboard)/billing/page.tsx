import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyRole } from '@/lib/tenant';
import { BillingPanel, type BillingStatus } from './billing-panel';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('billing');
  return { title: t('title') };
}

/**
 * The company's plan: trial countdown, Stripe subscription (card, wallets,
 * SEPA) or a year paid by bank transfer against a proforma. Price, period,
 * renewal and how to cancel sit next to the buttons (EU/CZ pre-contract
 * information, California ARL), and cancelling is one step in the portal.
 */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const locale = await getLocale();
  const t = await getTranslations('billing');
  const { checkout } = await searchParams;

  let status: BillingStatus;
  let role: string | null;
  try {
    [status, role] = await Promise.all([apiFetch<BillingStatus>('/api/v1/billing/subscription'), fetchMyRole()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      {checkout === 'success' && <Banner tone="ok" title={t('checkoutSuccess')} className="mt-4" />}
      {checkout === 'canceled' && <Banner tone="info" title={t('checkoutCanceled')} className="mt-4" />}
      <BillingPanel status={status} locale={locale} readOnly={!canManage(role)} />
    </div>
  );
}
