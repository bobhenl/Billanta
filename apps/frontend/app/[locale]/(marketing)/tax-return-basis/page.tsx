import type { Metadata } from 'next';
import { ArrowRight, CalendarClock, Check, Download, Layers, Percent, Scale, Wallet } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { OSVC_FLAT_EXPENSE_CAPS, SK_FLAT_EXPENSE_CAP, SK_FLAT_EXPENSE_SHARE, taxReturnDeadlines } from '@faktur/cz-compliance';
import { faqLd, FaqList, IconCards } from '@/components/segment-page';
import { Link } from '@/i18n/navigation';
import { CALCULATORS, isPublishedIn } from '@/lib/public-tools';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

const PATH = '/tax-return-basis';
// The year in the title and the deadlines move on by themselves.
export const revalidate = 86400;

/** The return being prepared: last year's until the end of June, then this year's. */
function filingYear(now: Date): number {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: 'numeric' })
    .formatToParts(now)
    .filter((p) => p.type !== 'literal')
    .map((p) => Number(p.value));
  return m! <= 6 ? y! - 1 : y!;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'taxReturn.landing' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle', { year: filingYear(new Date()) }), description: t('lead') });
}

const FEATURES = [
  { icon: Wallet, key: 'income' },
  { icon: Layers, key: 'categories' },
  { icon: Percent, key: 'flat' },
  { icon: Scale, key: 'flatTax' },
  { icon: CalendarClock, key: 'deadlines' },
  { icon: Download, key: 'export' }
] as const;

const CALCULATOR_SLUGS = ['self-employed-tax', 'slovak-self-employed-tax', 'flat-tax', 'minimum-advances'];

/**
 * Public page for the free "Podklady pro daňové přiznání" in the app: what
 * it puts together, this season's deadlines (computed, not typed in), the
 * paušály from the same tables the app uses, and links to the tax
 * calculators. The copy is year-agnostic; only the title and the dates
 * carry the year.
 */
export default async function TaxReturnBasisLanding({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('taxReturn.landing');
  const tTools = await getTranslations('tools');
  const format = await getFormatter();
  const year = filingYear(new Date());
  const date = (d: Date) => format.dateTime(d, { day: 'numeric', month: 'numeric', year: 'numeric' });
  const cz = taxReturnDeadlines('CZ', year);
  const sk = taxReturnDeadlines('SK', year);
  const czk = (n: number) => format.number(n, { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 });
  const eur = (n: number) => format.number(n, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const faq = t.raw('faq') as { q: string; a: string }[];
  // The Slovak reader sees the Slovak calculator first; a Czech-only one opens in Czech.
  const calculators = CALCULATORS.filter((c) => CALCULATOR_SLUGS.includes(c.slug)).sort((a, b) =>
    locale === 'sk' ? Number(b.slug.startsWith('slovak')) - Number(a.slug.startsWith('slovak')) : 0
  );
  const countries = locale === 'sk' ? (['SK', 'CZ'] as const) : (['CZ', 'SK'] as const);

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title', { year }), PATH]
          ]),
          webPageLd(locale, PATH, 'WebPage', t('title', { year }), t('lead')),
          faqLd(faq)
        ])}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title', { year })}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/signup" className={buttonClass.primary}>
          {t('cta')}
        </Link>
        <Link href="/demo" className={buttonClass.secondary}>
          {t('demo')}
        </Link>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{t('free')}</p>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('featuresTitle')}</h2>
      <IconCards items={FEATURES.map(({ icon, key }) => ({ icon, title: t(`features.${key}.title`), body: t(`features.${key}.body`) }))} />

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {countries.map((country) => (
          <div key={country} className="rounded-2xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold tracking-tight">{t(`country.${country}.title`, { year })}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {(country === 'CZ' ? cz : sk).map((d) => (
                <li key={d.kind} className="flex gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>
                    {t(`country.${country}.deadline.${d.kind}`)}: <strong className="tabular-nums">{date(d.date)}</strong>
                  </span>
                </li>
              ))}
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                  {country === 'CZ'
                    ? t('country.CZ.flat', {
                        caps: (Object.entries(OSVC_FLAT_EXPENSE_CAPS) as [string, number][])
                          .sort((a, b) => Number(b[0]) - Number(a[0]))
                          .map(([k, v]) => `${k} % (${czk(v)})`)
                          .join(', ')
                      })
                    : t('country.SK.flat', { rate: Math.round(SK_FLAT_EXPENSE_SHARE * 100), cap: eur(SK_FLAT_EXPENSE_CAP) })}
                </span>
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t(`country.${country}.extra`)}</span>
              </li>
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold tracking-tight">{t('calculatorsTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('calculatorsLead')}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {calculators.map((c) => (
            <li key={c.slug}>
              <Link
                href={`/calculators/${c.slug}`}
                locale={isPublishedIn(c, locale) ? undefined : 'cs'}
                className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
              >
                {tTools(`calculators.items.${c.key}.name`)}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('ctaTitle')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('ctaBody')}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/signup" className={buttonClass.primary}>
            {t('cta')}
          </Link>
        </div>
      </div>

      <FaqList title={t('faqTitle')} faq={faq} />
      <p className="mt-8 text-xs text-muted-foreground">{t('disclaimer')}</p>
    </section>
  );
}
