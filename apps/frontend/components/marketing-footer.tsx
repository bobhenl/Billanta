import { getLocale, getTranslations } from 'next-intl/server';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { InstallAppButton } from '@/components/install-app-button';
import { SITE_NAME } from '@/lib/site';

/**
 * Public-site footer: a compact link grid that doubles as secondary
 * navigation and as internal linking — every entry is a real, crawlable
 * `<a>`.
 */
export async function MarketingFooter() {
  const t = await getTranslations('marketing.footer');
  const tApp = await getTranslations('app');
  const tMunicipalities = await getTranslations('municipalityPages');
  const tTools = await getTranslations('tools');
  const tMenu = await getTranslations('tools.menu');
  const locale = await getLocale();
  const year = new Date().getFullYear();

  const columns = [
    {
      title: t('product.title'),
      links: [
        { href: '/funkce', label: t('product.features') },
        { href: '/vytvorit-fakturu', label: t('product.guestInvoice') },
        { href: '/pricing', label: t('product.pricing') },
        { href: '/srovnani', label: t('product.compare') },
        { href: '/#faq', label: t('product.faq') }
      ]
    },
    {
      // Only what is published in this language (lib/public-tools.ts).
      title: tMenu('resources'),
      links: [
        { href: '/kalkulacky', label: tMenu('calculators') },
        ...CALCULATORS.filter((c) => isPublishedIn(c, locale)).map((c) => ({
          href: `/kalkulacky/${c.slug}`,
          label: tTools(`calculators.items.${c.key}.name`)
        })),
        ...GUIDES.filter((g) => isPublishedIn(g, locale)).map((g) => ({
          href: `/navody/${g.slug}`,
          label: tTools(`guides.items.${g.key}.name`)
        }))
      ]
    },
    {
      title: t('company.title'),
      links: [
        { href: '/about', label: t('company.about') },
        { href: '/faktury-pro', label: tMunicipalities('breadcrumbBrowse') }
      ]
    },
    {
      title: t('legal.title'),
      links: [
        { href: '/legal/terms', label: t('legal.terms') },
        { href: '/legal/privacy', label: t('legal.privacy') },
        { href: '/legal/dpa', label: t('legal.dpa') },
        { href: '/legal/cookies', label: t('legal.cookies') }
      ]
    },
    {
      title: t('account.title'),
      links: [
        { href: '/login', label: t('account.login') },
        { href: '/signup', label: t('account.signup') }
      ]
    }
  ];

  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(5,1fr)]">
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
                    <Link href={link.href} className="text-foreground/80 transition-colors hover:text-primary">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>{t('copyright', { year, name: SITE_NAME })}</p>
          <div className="flex flex-wrap items-center gap-4">
            <InstallAppButton className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground" />
            <CookieSettingsButton label={t('legal.cookieSettings')} className="self-start transition-colors hover:text-foreground" />
          </div>
        </div>
      </div>
    </footer>
  );
}
