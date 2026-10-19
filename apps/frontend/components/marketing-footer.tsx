import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronDown } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BrandMark } from '@/components/brand-mark';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { FooterAccordion } from '@/components/footer-accordion';
import { InstallAppButton } from '@/components/install-app-button';
import { FooterAccountLinks } from '@/components/marketing-account-links';
import { fetchPartners, partnerHref } from '@/lib/partners';
import { CALCULATORS, GUIDES_HUB_LOCALES, isPublishedIn, type Calculator } from '@/lib/public-tools';

/**
 * The calculators the footer names directly, in order; the first four
 * published in the language are shown. The rest are one click away on the
 * hubs, which link every calculator and guide, so the footer stays a short
 * grid instead of a column as long as the registry.
 */
const FOOTER_CALCULATORS = ['self-employed-tax', 'vat', 'minimum-advances', 'cnb-exchange-rates', 'due-date'];
const FOOTER_CALCULATOR_COUNT = 4;

const COLUMN = 'footer-column';

/**
 * Public-site footer: a compact link grid that doubles as secondary
 * navigation and as internal linking — every entry is a real, crawlable
 * `<a>`. One block, as on VoxelRank: the cookie settings and "install app"
 * entries sit in the columns rather than in a second strip underneath, and
 * there is no "© … All rights reserved" line (copyright needs no notice).
 * Partners marked `show_in_footer` get a strip under the grid, linked
 * through the counting redirect.
 *
 * On phones each column is a `<details>` (see `FooterAccordion`), so the
 * footer is five headings rather than a long list. The account column
 * follows the session on the client, as the header and tab bar do, so the
 * page stays static.
 */
export async function MarketingFooter() {
  const t = await getTranslations('marketing.footer');
  const tApp = await getTranslations('app');
  const tMunicipalities = await getTranslations('municipalityPages');
  const tTools = await getTranslations('tools');
  const [locale, partners] = await Promise.all([getLocale(), fetchPartners({ footer: true })]);

  const linkClass = 'text-left text-foreground/80 transition-colors hover:text-primary';
  const hubClass = 'font-semibold text-primary hover:underline';
  const featured = FOOTER_CALCULATORS.map((slug) => CALCULATORS.find((c) => c.slug === slug))
    .filter((c): c is Calculator => c != null && isPublishedIn(c, locale))
    .slice(0, FOOTER_CALCULATOR_COUNT);

  const columns: { title: string; links: { href: string; label: string; hub?: boolean }[]; extra?: React.ReactNode }[] = [
    {
      title: t('product.title'),
      links: [
        { href: '/features', label: t('product.features') },
        { href: '/create-invoice', label: t('product.guestInvoice') },
        { href: '/pricing', label: t('product.pricing') },
        { href: '/compare', label: t('product.compare') },
        { href: '/your-first-invoice', label: t('product.firstInvoice') },
        { href: '/invoicing-for-beginners', label: t('product.beginners') },
        { href: '/invoicing-for-advanced', label: t('product.advanced') },
        { href: '/team-roles', label: t('product.teamRoles') },
        { href: '/#faq', label: t('product.faq') }
      ]
    },
    {
      title: tTools('menu.resources'),
      links: [
        ...featured.map((c) => ({ href: `/calculators/${c.slug}`, label: tTools(`calculators.items.${c.key}.name`) })),
        { href: '/accountants', label: tTools('menu.findAccountant') },
        { href: '/directory', label: tTools('menu.businessDirectory') },
        { href: '/calculators', label: tTools('common.allCalculators'), hub: true },
        ...(GUIDES_HUB_LOCALES.includes(locale) ? [{ href: '/guides', label: tTools('common.allGuides'), hub: true }] : []),
        { href: '/glossary', label: tTools('menu.glossary'), hub: true }
      ]
    },
    {
      title: t('company.title'),
      links: [
        { href: '/about', label: t('company.about') },
        { href: '/blog', label: t('company.blog') },
        { href: '/for-accountants', label: t('company.accountants') },
        { href: '/for-schools', label: t('company.schools') },
        { href: '/for-creators', label: t('company.creators') },
        { href: '/events', label: t('company.events') },
        { href: '/for-partners', label: t('company.forPartners') },
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
      links: [],
      extra: (
        <>
          <FooterAccountLinks className={linkClass} />
          <li>
            <InstallAppButton className={`inline-flex items-center gap-1.5 ${linkClass}`} />
          </li>
        </>
      )
    }
  ];

  return (
    <footer className="border-t border-border bg-card/40">
      <div className="container py-10">
        <div className="grid gap-x-8 sm:grid-cols-3 sm:gap-y-8 lg:grid-cols-[1.5fr_repeat(5,1fr)]">
          <div className="mb-4 max-w-xs sm:col-span-3 sm:mb-0 lg:col-span-1">
            <p className="flex items-center gap-2 text-base font-bold tracking-tight">
              <BrandMark />
              {tApp('name')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title} className="border-b border-border sm:border-0">
              <details open className={`${COLUMN} group`}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-xs font-bold uppercase tracking-wider text-muted-foreground sm:pointer-events-none sm:cursor-default sm:py-0 [&::-webkit-details-marker]:hidden">
                  {column.title}
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 sm:hidden" aria-hidden="true" />
                </summary>
                <ul className="space-y-2 pb-4 text-sm sm:mt-3 sm:pb-0">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={link.hub ? hubClass : linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {column.extra}
                </ul>
              </details>
            </nav>
          ))}
        </div>
        <FooterAccordion selector={`details.${COLUMN}`} />

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
