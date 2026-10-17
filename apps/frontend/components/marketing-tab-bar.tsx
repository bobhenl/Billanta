'use client';

import { BadgePercent, Calculator, CircleHelp, Handshake, Home, LayoutDashboard, LogIn, Plus, Sparkles, UserRound } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { MobileTabBar } from '@/components/mobile-tab-bar';

/**
 * Phone tab bar for the public site, in VoxelRank's order: home, a
 * destination, the one accent CTA in the middle, the account slot and
 * "More". The account slot is VoxelRank's "Profile": log in for a visitor,
 * the app for someone signed in; "More" also carries sign-up and log-in
 * buttons so neither is ever more than one tap away. Language and theme stay
 * in the phone header, as on VoxelRank.
 */
export function MarketingTabBar() {
  const t = useTranslations('marketing.nav');
  const tMobile = useTranslations('mobile');
  const { status } = useSession();
  const signedIn = status === 'authenticated';

  return (
    <MobileTabBar
      label={t('label')}
      items={[
        { key: 'home', href: '/', label: t('home'), icon: Home, exact: true },
        { key: 'pricing', href: '/pricing', label: t('pricing'), icon: BadgePercent },
        { key: 'invoice', href: '/create-invoice', label: t('createInvoiceShort'), icon: Plus, cta: true },
        signedIn
          ? { key: 'app', href: '/dashboard', label: t('app'), icon: LayoutDashboard }
          : { key: 'login', href: '/login', label: t('account'), icon: UserRound }
      ]}
      moreLabel={tMobile('more')}
      panelTitle={tMobile('explore')}
      links={[
        { key: 'features', href: '/features', label: t('features'), icon: Sparkles },
        { key: 'accountants', href: '/for-accountants', label: t('accountants'), icon: Calculator },
        { key: 'partners', href: '/partners', label: t('partners'), icon: Handshake },
        { key: 'faq', href: '/#faq', label: t('faq'), icon: CircleHelp }
      ]}
      panelFooter={
        signedIn ? undefined : (
          <div className="flex gap-2">
            <Link
              href="/signup"
              className="inline-flex flex-1 items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              {t('signup')}
            </Link>
            <Link
              href="/login"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {t('login')}
            </Link>
          </div>
        )
      }
    />
  );
}
