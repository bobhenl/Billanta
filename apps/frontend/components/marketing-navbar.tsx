import { getTranslations } from 'next-intl/server';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Header for the public site. Separate from the dashboard shell — the two
 * audiences need different links. Only the pages a visitor is here for sit
 * in the header; secondary ones (about, cities, legal) live in the footer. On phones it shrinks to brand + language
 * + theme; navigation moves to `MarketingTabBar` at the bottom.
 */
export async function MarketingNavbar() {
  const t = await getTranslations('marketing.nav');
  const tApp = await getTranslations('app');

  const links = [
    { href: '/funkce', label: t('features') },
    { href: '/pricing', label: t('pricing') },
    { href: '/#faq', label: t('faq') }
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
        </nav>

        <div className="flex items-center gap-1.5">
          <Link
            href="/hledat"
            aria-label={t('search')}
            title={t('search')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
          </Link>
          <LanguageSwitcher />
          <ThemeToggle />
          <Link
            href="/login"
            className="hidden rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground md:inline-block"
          >
            {t('login')}
          </Link>
          <Link
            href="/signup"
            className="hidden rounded-full bg-primary px-4 py-1.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 md:inline-block"
          >
            {t('signup')}
          </Link>
        </div>
      </div>
    </header>
  );
}
