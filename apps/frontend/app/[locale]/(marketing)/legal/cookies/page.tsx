import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CookieSettingsButton } from '@/components/cookie-settings-button';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'cookies.page' });
  return publicPageMetadata({ locale, path: '/legal/cookies', title: t('seoTitle'), description: t('intro') });
}

/**
 * Cookie policy. Unlike terms/privacy this is not a placeholder: it lists
 * the cookies this app actually sets, which is a technical fact. Keep the
 * table in step with the code — Auth.js session cookies (auth.ts), the
 * next-intl locale cookie, the consent cookie (lib/consent.ts) and
 * Clarity's cookies (components/clarity.tsx).
 */
const ROWS = [
  { name: 'authjs.session-token', category: 'necessary', key: 'session' },
  { name: 'authjs.csrf-token, authjs.callback-url', category: 'necessary', key: 'csrf' },
  { name: 'NEXT_LOCALE', category: 'necessary', key: 'locale' },
  { name: 'billanta_consent', category: 'necessary', key: 'consent' },
  { name: 'theme (localStorage)', category: 'necessary', key: 'theme' },
  { name: '_clck, _clsk, CLID, MUID', category: 'analytics', key: 'clarity' }
] as const;

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
      <h1 className="text-3xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-3 text-muted-foreground">{t('intro')}</p>

      <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
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
                  <span
                    className={
                      row.category === 'necessary'
                        ? 'rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold'
                        : 'rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground'
                    }
                  >
                    {t(`categories.${row.category}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{t(`rows.${row.key}.duration`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-8 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>{t('analyticsNote')}</p>
        <p>{t('withdraw')}</p>
      </div>

      <CookieSettingsButton
        label={t('change')}
        className="mt-6 inline-flex rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
      />
    </section>
  );
}
