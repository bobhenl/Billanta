'use client';

import { BadgePercent, BookA, BookOpenCheck, Calculator, CalendarDays, CircleHelp, Clapperboard, FileText, GraduationCap, Handshake, Home, LayoutDashboard, LogIn, Megaphone, Newspaper, Plus, Sparkles, SquarePercent, Store, UserRound, Users, UserSearch } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useCreateInvoiceHref } from '@/components/marketing-account-links';
import { MobileTabBar } from '@/components/mobile-tab-bar';
import { GUIDES_HUB_LOCALES } from '@/lib/public-tools';

/**
 * Phone tab bar for the public site, in VoxelRank's order: home, a
 * destination, the one accent CTA in the middle, the account slot and
 * "More". The account slot is VoxelRank's "Profile": log in for a visitor,
 * the app for someone signed in; "More" also carries sign-up and log-in
 * buttons so neither is ever more than one tap away. Language and theme stay
 * in the phone header, as on VoxelRank. "More" also carries the pages of
 * the header's Resources dropdown (calculators, guides where published).
 */
export function MarketingTabBar() {
  const t = useTranslations('marketing.nav');
  const tMobile = useTranslations('mobile');
  const tMenu = useTranslations('tools.menu');
  const locale = useLocale();
  const { status } = useSession();
  const signedIn = status === 'authenticated';
  const createInvoiceHref = useCreateInvoiceHref();

  return (
    <MobileTabBar
      label={t('label')}
      items={[
        { key: 'home', href: '/', label: t('home'), icon: Home, exact: true },
        { key: 'pricing', href: '/pricing', label: t('pricing'), icon: BadgePercent },
        { key: 'invoice', href: createInvoiceHref, label: t('createInvoiceShort'), icon: Plus, cta: true },
        signedIn
          ? { key: 'app', href: '/dashboard', label: t('app'), icon: LayoutDashboard }
          : { key: 'login', href: '/login', label: t('account'), icon: UserRound }
      ]}
      moreLabel={tMobile('more')}
      panelTitle={tMobile('explore')}
      links={[
        { key: 'features', href: '/features', label: t('features'), icon: Sparkles },
        // Calculator is taken by the accountants link, so the calculators get a percent sign.
        { key: 'calculators', href: '/calculators', label: tMenu('calculators'), icon: SquarePercent },
        ...(GUIDES_HUB_LOCALES.includes(locale) ? [{ key: 'guides', href: '/guides', label: tMenu('guides'), icon: BookOpenCheck }] : []),
        { key: 'glossary', href: '/glossary', label: tMenu('glossary'), icon: BookA },
        { key: 'find-accountant', href: '/accountants', label: tMenu('findAccountant'), icon: UserSearch },
        { key: 'directory', href: '/directory', label: tMenu('businessDirectory'), icon: Store },
        { key: 'blog', href: '/blog', label: tMenu('blog'), icon: Newspaper },
        { key: 'first-invoice', href: '/your-first-invoice', label: t('firstInvoice'), icon: FileText },
        { key: 'team-roles', href: '/team-roles', label: t('teamRoles'), icon: Users },
        { key: 'accountants', href: '/for-accountants', label: t('accountants'), icon: Calculator },
        { key: 'schools', href: '/for-schools', label: t('schools'), icon: GraduationCap },
        { key: 'creators', href: '/for-creators', label: t('creators'), icon: Clapperboard },
        { key: 'events', href: '/events', label: t('events'), icon: CalendarDays },
        { key: 'for-partners', href: '/for-partners', label: t('forPartners'), icon: Megaphone },
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
