import type { Metadata } from 'next';
import { Coins, Gift, MessagesSquare, Presentation, Ticket, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerSegmentPage } from '@/components/partner-segment';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.communities' });
  return publicPageMetadata({ locale, path: '/for-communities', title: t('seoTitle'), description: t('lead') });
}

/** For associations of the self-employed, unions and online groups: a member code, an optional talk and referral credit. */
export default async function ForCommunitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <PartnerSegmentPage
      locale={locale}
      segment="communities"
      offers={[
        { key: 'code', icon: Ticket },
        { key: 'benefit', icon: Gift },
        { key: 'talk', icon: Presentation },
        { key: 'credit', icon: Coins },
        { key: 'online', icon: MessagesSquare },
        { key: 'members', icon: Users }
      ]}
    />
  );
}
