import type { Metadata } from 'next';
import { Landmark, RefreshCw, Rocket, ShieldCheck, Ticket, Webhook } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerChecklist, PartnerSegmentPage } from '@/components/partner-segment';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.banks' });
  return publicPageMetadata({ locale, path: '/for-banks', title: t('seoTitle'), description: t('lead') });
}

/** B2B page for banks: an offer for business-account clients, bank sync and co-branded codes. Contact only, no demo button. */
export default async function ForBanksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnerSegments.banks');
  return (
    <PartnerSegmentPage
      locale={locale}
      segment="banks"
      demo={false}
      how={false}
      offers={[
        { key: 'clients', icon: Landmark },
        { key: 'sync', icon: RefreshCw },
        { key: 'cobranded', icon: Ticket },
        { key: 'onboarding', icon: Rocket },
        { key: 'api', icon: Webhook },
        { key: 'security', icon: ShieldCheck }
      ]}
    >
      <PartnerChecklist className="mt-12" title={t('models.title')} lead={t('models.lead')} points={t.raw('models.points') as string[]} />
    </PartnerSegmentPage>
  );
}
