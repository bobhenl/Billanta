import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SITE_NAME } from '@/lib/site';

/**
 * Footer for the public marketing site. Expanded from a single link row into
 * a multi-column layout (Product / Company / Legal / Account) — the original
 * version only linked About/Terms/Privacy, which under-used the footer as a
 * secondary navigation and internal-linking surface (the latter matters for
 * SEO: every column link is a real, crawlable `<a>`, not JS-only nav).
 *
 * `/pricing` and `/login` don't exist as pages yet (see
 * `marketing-navbar.tsx`'s same TODO) — linked anyway per that file's
 * precedent of linking ahead of the page existing.
 */
export async function MarketingFooter() {
  const t = await getTranslations('marketing.footer');
  const tApp = await getTranslations('app');
  const tMunicipalities = await getTranslations('municipalityPages');
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <div className="container py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-xs">
            <p className="font-display text-lg font-semibold text-foreground">{tApp('name')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          <nav aria-label={t('product.title')}>
            <p className="text-sm font-semibold text-foreground">{t('product.title')}</p>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <a href="/#features" className="transition-colors hover:text-foreground">
                  {t('product.features')}
                </a>
              </li>
              <li>
                {/* TODO: /pricing doesn't exist yet — placeholder link only, matching marketing-navbar.tsx's precedent. */}
                <Link href="/pricing" className="transition-colors hover:text-foreground">
                  {t('product.pricing')}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={t('company.title')}>
            <p className="text-sm font-semibold text-foreground">{t('company.title')}</p>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <Link href="/about" className="transition-colors hover:text-foreground">
                  {t('company.about')}
                </Link>
              </li>
              <li>
                <Link href="/faktury-pro" className="transition-colors hover:text-foreground">
                  {tMunicipalities('breadcrumbBrowse')}
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label={t('legal.title')}>
            <p className="text-sm font-semibold text-foreground">{t('legal.title')}</p>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>
                <Link href="/legal/terms" className="transition-colors hover:text-foreground">
                  {t('legal.terms')}
                </Link>
              </li>
              <li>
                <Link href="/legal/privacy" className="transition-colors hover:text-foreground">
                  {t('legal.privacy')}
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t('copyright', { year, name: SITE_NAME })}</p>
          <nav aria-label={t('account.title')} className="flex items-center gap-6">
            <Link href="/login" className="transition-colors hover:text-foreground">
              {t('account.login')}
            </Link>
            <Link href="/signup" className="font-medium text-foreground transition-colors hover:text-primary">
              {t('account.signup')}
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
