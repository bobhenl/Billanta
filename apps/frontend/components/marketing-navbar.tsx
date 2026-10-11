import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Navbar for the public marketing site (currently just `/`). Kept separate
 * from `dashboard-nav.tsx`/`(dashboard)/layout.tsx`'s navbar since the two
 * audiences (anonymous visitors vs. signed-in users) need different links
 * and neither should leak into the other.
 *
 * A server component — translations are resolved server-side via
 * `getTranslations`; the interactive bits (`LanguageSwitcher`, `ThemeToggle`)
 * are self-contained client components embedded below.
 */
export async function MarketingNavbar() {
  const t = await getTranslations('marketing.nav');
  const tApp = await getTranslations('app');

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container flex h-16 items-center justify-between gap-4">
        {/* `tApp('name')` — see the comment on `app.name`'s first usage in
            app/[locale]/layout.tsx: it's a provisional placeholder name. */}
        <Link href="/" className="font-display shrink-0 text-lg font-semibold tracking-tight">
          {tApp('name')}
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <a
            href="#features"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('features')}
          </a>
          {/* TODO: /pricing doesn't exist yet — placeholder link only. */}
          <Link
            href="/pricing"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('pricing')}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          {/* TODO: /login doesn't exist yet — placeholder link only, page is out of scope here. */}
          <Link
            href="/login"
            className="hidden shrink-0 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
          >
            {t('login')}
          </Link>
          <Link
            href="/signup"
            className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t('signup')}
          </Link>
        </div>
      </div>
    </header>
  );
}
