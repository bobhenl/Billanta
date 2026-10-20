import type { Metadata } from 'next';
import { Coins, Download, Gift, Infinity as Permanent, Printer, QrCode, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerSegmentPage } from '@/components/partner-segment';
import { Link } from '@/i18n/navigation';
import { publicPageMetadata } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.coworkings' });
  return publicPageMetadata({ locale, path: '/for-coworkings', title: t('seoTitle'), description: t('lead') });
}

/** For coworkings: one permanent group code for all members, a poster on the wall and referral credit for the space. */
export default async function ForCoworkingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('coworkingPoster');
  return (
    <PartnerSegmentPage
      locale={locale}
      segment="coworkings"
      offers={[
        { key: 'permanent', icon: Permanent },
        { key: 'benefit', icon: Gift },
        { key: 'credit', icon: Coins },
        { key: 'poster', icon: Printer },
        { key: 'qr', icon: QrCode },
        { key: 'members', icon: Users }
      ]}
    >
      {/* The poster the offers promise, printable right away (./poster). */}
      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t('ctaTitle')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('ctaBody')}</p>
        </div>
        <Link href="/for-coworkings/poster" className={`${buttonClass.primary} shrink-0`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {t('ctaButton')}
        </Link>
      </div>
    </PartnerSegmentPage>
  );
}
