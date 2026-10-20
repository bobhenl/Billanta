import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { LanguageSwitcher } from '@/components/language-switcher';
import { AttributionCookie } from '@/components/signup-attribution';
import { ThemeToggle } from '@/components/theme-toggle';

// Sign-in, sign-up and password forms have no search value; keep them out
// of the index (robots.ts still lets crawlers fetch them to see this).
export const metadata: Metadata = { robots: { index: false, follow: true } };

/**
 * Minimal chrome for the auth forms: brand back to home, language, theme,
 * and one footer line with the legal links (the form is the page's only
 * job, so no full navbar or footer, the way most SaaS sign-in pages do it).
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const tApp = await getTranslations('app');
  const tFooter = await getTranslations('marketing.footer');
  return (
    <div className="relative">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="container flex h-14 items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-base font-bold tracking-tight">
            <BrandMark />
            {tApp('name')}
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {children}
      <footer className="container flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pb-6 text-xs text-muted-foreground">
        <Link href="/legal/terms" className="transition-colors hover:text-foreground">
          {tFooter('legal.terms')}
        </Link>
        <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
          {tFooter('legal.privacy')}
        </Link>
        <CookieSettingsButton label={tFooter('legal.cookieSettings')} className="transition-colors hover:text-foreground" />
      </footer>
      {/* A visitor who lands straight on /signup from a tagged link and
          consented on an earlier visit (or needs no banner) is still counted. */}
      <AttributionCookie />

    </div>
  );
}
