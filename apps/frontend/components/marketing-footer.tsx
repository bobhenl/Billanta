import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { InstallAppButton } from '@/components/install-app-button';
import { fetchPartners, partnerHref } from '@/lib/partners';

/**
 * Public-site footer: a compact link grid that doubles as secondary
 * navigation and as internal linking — every entry is a real, crawlable
 * `<a>`. One block, as on VoxelRank: the cookie settings and "install app"
 * entries sit in the columns rather than in a second strip underneath, and
 * there is no "© … All rights reserved" line (copyright needs no notice).
 * Partners marked `show_in_footer` get a strip under the grid, linked
 * through the counting redirect.
 */
export async function MarketingFooter() {
  const t = await getTranslations('marketing.footer');
  const tApp = await getTranslations('app');
  const tMunicipalities = await getTranslations('municipalityPages');
  const [locale, partners] = await Promise.all([getLocale(), fetchPartners({ footer: true })]);

  const linkClass = 'text-left text-foreground/80 transition-colors hover:text-primary';
  const columns: { title: string; links: { href: string; label: string }[]; extra?: React.ReactNode }[] = [
    {
      title: t('product.title'),
      links: [
        { href: '/features', label: t('product.features') },
        { href: '/create-invoice', label: t('product.guestInvoice') },
        { href: '/pricing', label: t('product.pricing') },
        { href: '/compare', label: t('product.compare') },
        { href: '/#faq', label: t('product.faq') }
      ]
    },
    {
      title: t('company.title'),
      links: [
        { href: '/about', label: t('company.about') },
        { href: '/for-accountants', label: t('company.accountants') },
        { href: '/partners', label: t('company.partners') },
        { href: '/invoicing', label: tMunicipalities('breadcrumbBrowse') }
      ]
    },
    {
      title: t('legal.title'),
      links: [
        { href: '/legal/terms', label: t('legal.terms') },
        { href: '/legal/privacy', label: t('legal.privacy') },
        { href: '/legal/dpa', label: t('legal.dpa') },
        { href: '/legal/cookies', label: t('legal.cookies') }
      ],
      extra: (
        <li>
          <CookieSettingsButton label={t('legal.cookieSettings')} className={linkClass} />
        </li>
      )
    },
    {
      title: t('account.title'),
      links: [
        { href: '/login', label: t('account.login') },
        { href: '/signup', label: t('account.signup') }
      ],
      extra: (
        <li>
          <InstallAppButton className={`inline-flex items-center gap-1.5 ${linkClass}`} />
        </li>
      )
    }
  ];

  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div className="col-span-2 max-w-xs sm:col-span-3 lg:col-span-1">
            <p className="flex items-center gap-2 text-base font-bold tracking-tight">
              <BrandMark />
              {tApp('name')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{column.title}</p>
              <ul className="mt-3 space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
                {column.extra}
              </ul>
            </nav>
          ))}
        </div>

        {partners.length > 0 && (
          <nav aria-label={t('partners.title')} className="mt-8 border-t border-border pt-6">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('partners.title')}</span>
              {partners.map((p) => (
                <a key={p.slug} href={partnerHref(locale, p.slug)} target="_blank" rel="sponsored noopener" className={linkClass}>
                  {p.name}
                </a>
              ))}
              <Link href="/partners" className="font-semibold text-primary hover:underline">
                {t('partners.all')}
              </Link>
            </div>
          </nav>
        )}
      </div>
    </footer>
  );
}
