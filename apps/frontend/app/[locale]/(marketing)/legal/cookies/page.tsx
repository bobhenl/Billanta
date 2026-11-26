import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cookies.page' });
  return publicPageMetadata({ locale, path: '/legal/cookies', title: t('seoTitle'), description: t('intro') });
}

/**
 * Cookie policy. Unlike terms/privacy this is not a placeholder: it lists
 * the cookies this app actually sets, which is a technical fact. Keep the
 * table in step with the code: Auth.js cookies (auth.ts; the demo and
 * classroom sessions in lib/demo-session.ts use the same session cookie),
 * the active company (lib/tenant-actions.ts), the demo hand-over
 * (app/api/demo/transfer), the next-intl locale cookie (a session cookie,
 * no maxAge in i18n/routing.ts), the consent cookie and region answer
 * (lib/consent.ts), the invoice list filters (lib/invoice-list-prefs.ts),
 * the link cookies (middleware.ts), the attribution cookie
 * (components/signup-attribution.tsx) and Clarity's cookies
 * (components/clarity.tsx).
 */
const ROWS = [
  { name: 'authjs.session-token', category: 'necessary', key: 'session' },
  { name: 'authjs.csrf-token, authjs.callback-url', category: 'necessary', key: 'csrf' },
  { name: 'authjs.pkce.code_verifier, authjs.state, authjs.nonce', category: 'necessary', key: 'oauth' },
  { name: 'billanta_tenant', category: 'necessary', key: 'tenant' },
  { name: 'billanta_demo_transfer', category: 'necessary', key: 'demoTransfer' },
  { name: 'NEXT_LOCALE', category: 'necessary', key: 'locale' },
  { name: 'billanta_consent', category: 'necessary', key: 'consent' },
  { name: 'billanta-region (localStorage)', category: 'necessary', key: 'region' },
  { name: 'theme (localStorage)', category: 'necessary', key: 'theme' },
  { name: 'billanta_ref', category: 'functional', key: 'referral' },
  { name: 'billanta_promo', category: 'functional', key: 'promo' },
  { name: 'billanta_switch_from', category: 'functional', key: 'switch' },
  { name: 'billanta_inv_quick', category: 'functional', key: 'invoiceFilters' },
  { name: 'localStorage, sessionStorage', category: 'functional', key: 'preferences' },
  { name: 'billanta_src', category: 'analytics', key: 'attribution' },
  { name: '_clck, _clsk, CLID, ANONCHK, MR, MUID, SM', category: 'analytics', key: 'clarity' }
] as const;

function CategoryBadge({ category, label }: { category: (typeof ROWS)[number]['category']; label: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        category === 'analytics' ? 'bg-accent text-accent-foreground' : 'bg-secondary'
      )}
    >
      {label}
    </span>
  );
}

export default async function CookiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cookies.page');

  return (
    <section className="container max-w-3xl py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, '/legal/cookies', 'WebPage', t('title'), t('intro')),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/legal/cookies']
          ])
        ])}
      />
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground sm:text-lg">{t('intro')}</p>

      {/* Four columns don't fit a phone, so there each cookie is its own card. */}
      <ul className="mt-8 space-y-3 sm:hidden">
        {ROWS.map((row) => (
          <li key={row.key} className="rounded-xl border border-border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 [overflow-wrap:anywhere] font-mono text-xs">{row.name}</span>
              <CategoryBadge category={row.category} label={t(`categories.${row.category}`)} />
            </div>
            <p className="mt-2 text-muted-foreground">{t(`rows.${row.key}.purpose`)}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{t('columns.duration')}:</span> {t(`rows.${row.key}.duration`)}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8 hidden overflow-x-auto rounded-xl border border-border bg-card sm:block">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-bold">{t('columns.name')}</th>
              <th className="px-4 py-3 font-bold">{t('columns.purpose')}</th>
              <th className="px-4 py-3 font-bold">{t('columns.category')}</th>
              <th className="px-4 py-3 font-bold">{t('columns.duration')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ROWS.map((row) => (
              <tr key={row.key}>
                <td className="px-4 py-3 font-mono text-xs">{row.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{t(`rows.${row.key}.purpose`)}</td>
                <td className="px-4 py-3">
                  <CategoryBadge category={row.category} label={t(`categories.${row.category}`)} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{t(`rows.${row.key}.duration`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 max-w-2xl space-y-3 text-[15px] leading-7 text-foreground/90">
        <p>{t('functionalNote')}</p>
        <p>{t('analyticsNote')}</p>
        <p>{t('attributionNote')}</p>
        <p>{t('schoolsNote')}</p>
        <p>{t('withdraw')}</p>
      </div>

      <CookieSettingsButton
        label={t('change')}
        className={cn(buttonClass.primary, 'mt-6')}
      />
    </section>
  );
}
