import { getTranslations } from 'next-intl/server';

export default async function DashboardHomePage() {
  const t = await getTranslations('dashboard');

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('welcome')}</p>
      {/* TODO: summary cards (open invoices, overdue amount, MRR, etc.) once
          the backend's invoice/billing endpoints exist. */}
    </div>
  );
}
