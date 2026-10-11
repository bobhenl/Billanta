import type { ComponentType } from 'react';
import type { Metadata } from 'next';
import { ArrowRight, FileCheck2, FileText, Globe, Mic, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { MarketingFooter } from '@/components/marketing-footer';
import { MarketingInvoiceMockup } from '@/components/marketing-invoice-mockup';
import { MarketingNavbar } from '@/components/marketing-navbar';
import { SITE_URL } from '@/lib/site';

/**
 * Public marketing homepage — the main SEO entry point for the product.
 * This route used to unconditionally `redirect('/dashboard')` (see git
 * history / the old inline comment), which is bad for both SEO and for
 * actually explaining the product to a visitor who isn't signed in yet.
 *
 * There is no auth/session check wired up anywhere in this scaffold yet, so
 * this page is public-only for now.
 *
 * TODO: once auth session exists, redirect authenticated users to
 * /dashboard from here.
 */

/**
 * Page-specific SEO metadata. The shared `app/[locale]/layout.tsx` only sets
 * a generic default title/description — it has no way to know a given
 * page's own path, so it can't emit a correct canonical URL or per-language
 * `<link rel="alternate" hreflang>` tags on its own. Those are HTML-head
 * signals, distinct from (and in addition to) the hreflang entries already
 * emitted for every page in `app/sitemap.ts` — Google explicitly recommends
 * both, not just the sitemap one. Every static marketing page should get its
 * own `generateMetadata` following this exact pattern; this one covers the
 * homepage specifically since that's the primary entry point.
 */
export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'marketing' });
  const tApp = await getTranslations({ locale, namespace: 'app' });

  const languages: Record<string, string> = {};
  for (const l of routing.locales) {
    languages[l] = `${SITE_URL}/${l}`;
  }
  languages['x-default'] = `${SITE_URL}/${routing.defaultLocale}`;

  const title = tApp('name');
  const description = t('hero.subtitle');
  const url = `${SITE_URL}/${locale}`;

  return {
    alternates: { canonical: url, languages },
    openGraph: {
      title,
      description,
      url,
      siteName: tApp('name'),
      locale,
      type: 'website'
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description
    }
  };
}

type FeatureKey = 'isdoc' | 'aiVoice' | 'compliance' | 'multilang';
type StepKey = 'capture' | 'draft' | 'issue' | 'getPaid';

const STEPS: { key: StepKey; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'capture', icon: Mic },
  { key: 'draft', icon: Sparkles },
  { key: 'issue', icon: FileCheck2 },
  { key: 'getPaid', icon: Send }
];

// aiVoice (voice-to-invoice) is the product's most distinctive feature, so
// it gets a larger, featured card below rather than sitting in a row of
// four identical boxes — see the features section for the layout.
const FEATURED_ITEM: { key: FeatureKey; icon: ComponentType<{ className?: string }> } = {
  key: 'aiVoice',
  icon: Mic
};

const SECONDARY_ITEMS: { key: FeatureKey; icon: ComponentType<{ className?: string }> }[] = [
  { key: 'isdoc', icon: FileText },
  { key: 'compliance', icon: ShieldCheck },
  { key: 'multilang', icon: Globe }
];

export default async function RootPage() {
  const t = await getTranslations('marketing');

  return (
    <div className="flex min-h-screen flex-col">
      <MarketingNavbar />

      <main className="flex-1">
        <section className="overflow-hidden border-b border-border">
          <div className="container grid gap-14 py-20 sm:py-28 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
            <div className="flex flex-col items-start gap-6 text-left">
              <h1 className="font-display max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">
                {t('hero.title')}
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">{t('hero.subtitle')}</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
                >
                  {t('hero.cta')}
                </Link>
                <a
                  href="#features"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
                >
                  {t('hero.secondaryCta')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </div>

            <div className="mx-auto w-full max-w-md lg:mx-0">
              <MarketingInvoiceMockup />
            </div>
          </div>
        </section>

        <section id="features" className="border-b border-border bg-muted/30 py-20 sm:py-28">
          <div className="container">
            <h2 className="font-display mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('features.title')}
            </h2>

            <div className="mt-14 grid gap-6">
              <div className="grid gap-6 rounded-2xl border border-border bg-card p-8 shadow-sm sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-10">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <FEATURED_ITEM.icon className="h-7 w-7" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-card-foreground">
                    {t(`features.${FEATURED_ITEM.key}.title`)}
                  </h3>
                  <p className="mt-2 max-w-2xl text-muted-foreground">
                    {t(`features.${FEATURED_ITEM.key}.description`)}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 sm:grid-cols-3">
                {SECONDARY_ITEMS.map(({ key, icon: Icon }) => (
                  <div key={key} className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-semibold text-card-foreground">{t(`features.${key}.title`)}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{t(`features.${key}.description`)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border py-20 sm:py-28">
          <div className="container">
            <h2 className="font-display mx-auto max-w-2xl text-center text-3xl font-semibold tracking-tight sm:text-4xl">
              {t('howItWorks.title')}
            </h2>

            <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ key, icon: Icon }, index) => (
                <li key={key} className="relative flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {index + 1}
                    </div>
                    <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <h3 className="font-semibold text-card-foreground">{t(`howItWorks.steps.${key}.title`)}</h3>
                  <p className="text-sm text-muted-foreground">{t(`howItWorks.steps.${key}.description`)}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-primary py-16 text-primary-foreground sm:py-20">
          <div className="container flex flex-col items-center gap-4 text-center">
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {t('finalCta.title')}
            </h2>
            <p className="max-w-md text-primary-foreground/85">{t('finalCta.subtitle')}</p>
            <Link
              href="/signup"
              className="mt-2 inline-flex items-center justify-center rounded-md bg-primary-foreground px-6 py-3 text-sm font-semibold text-primary transition-opacity hover:opacity-90"
            >
              {t('finalCta.cta')}
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
