import { getLocale, getTranslations } from 'next-intl/server';
import { Plus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { MarketingNavMenu } from '@/components/marketing-nav-menu';
import { MarketingSearch } from '@/components/marketing-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { GUIDES_HUB_LOCALES } from '@/lib/public-tools';

/**
 * Header for the public site. Separate from the dashboard shell — the two
 * audiences need different links. Only the pages a visitor is here for sit
 * in the header; the secondary ones (calculators, guides, FAQ, comparison)
 * share one "Resources" dropdown in the third slot, so the row stays at three
 * items. The rest (about, cities, legal) live in the footer. On phones it
 * shrinks to brand + search + language + theme; navigation moves to
 * `MarketingTabBar` at the bottom.
 *
 * As on VoxelRank ("Log in" + "+ Add server"), the one accent button is the
 * thing people come to do, issuing an invoice (no account needed), not
 * "Sign up"; sign-up is linked from the login page, the guest invoice and
 * the footer.
 */
export async function MarketingNavbar() {
  const t = await getTranslations('marketing.nav');
  const tApp = await getTranslations('app');
  const tMenu = await getTranslations('tools.menu');
  const locale = await getLocale();

  const links = [
    { href: '/features', label: t('features') },
    { href: '/pricing', label: t('pricing') }
  ];
  const resources = [
    { href: '/calculators', label: tMenu('calculators'), hint: tMenu('calculatorsHint') },
    ...(GUIDES_HUB_LOCALES.includes(locale) ? [{ href: '/guides', label: tMenu('guides'), hint: tMenu('guidesHint') }] : []),
    { href: '/#faq', label: t('faq') },
    { href: '/compare', label: tMenu('compare') }
  ];

  return (
    <header className="site-header sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight">
          <BrandMark />
          {tApp('name')}
        </Link>

        <nav aria-label={t('label')} className="hidden items-center gap-1 md:flex">
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {label}
            </Link>
          ))}
          <MarketingNavMenu label={tMenu('resources')} items={resources} />
        </nav>

        <div className="flex items-center gap-1.5">
          <MarketingSearch />
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            {t('login')}
          </Link>
          <Link
            href="/create-invoice"
            className="hidden items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 md:inline-flex"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('createInvoice')}
          </Link>
        </div>
      </div>
    </header>
  );
}
