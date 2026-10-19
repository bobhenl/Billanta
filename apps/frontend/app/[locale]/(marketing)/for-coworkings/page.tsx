import type { Metadata } from 'next';
import { Coins, Gift, Infinity as Permanent, Printer, QrCode, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerSegmentPage } from '@/components/partner-segment';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.coworkings' });
  return publicPageMetadata({ locale, path: '/for-coworkings', title: t('seoTitle'), description: t('lead') });
}

/** For coworkings: one permanent group code for all members, a poster on the wall and referral credit for the space. */
export default async function ForCoworkingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
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
    />
  );
}
