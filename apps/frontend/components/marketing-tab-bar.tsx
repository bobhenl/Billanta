'use client';

import { BadgePercent, CircleHelp, Home, LogIn, Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MobileTabBar } from '@/components/mobile-tab-bar';

/**
 * Phone tab bar for the public site, in VoxelRank's order: home, a
 * destination, the one accent CTA in the middle, "More", and the account
 * slot. Language and theme stay in the phone header, as on VoxelRank;
 * secondary pages (about, cities, legal) are footer-only.
 */
export function MarketingTabBar() {
  const t = useTranslations('marketing.nav');
  const tMobile = useTranslations('mobile');

  return (
    <MobileTabBar
      label={t('label')}
      items={[
        { key: 'home', href: '/', label: t('home'), icon: Home, exact: true },
        { key: 'pricing', href: '/pricing', label: t('pricing'), icon: BadgePercent },
        { key: 'invoice', href: '/vytvorit-fakturu', label: t('createInvoiceShort'), icon: Plus, cta: true },
        { key: 'login', href: '/login', label: t('login'), icon: LogIn }
      ]}
      moreLabel={tMobile('more')}
      panelTitle={tMobile('explore')}
      links={[
        { key: 'features', href: '/funkce', label: t('features'), icon: Sparkles },
        { key: 'faq', href: '/#faq', label: t('faq'), icon: CircleHelp }
      ]}
    />
  );
}
