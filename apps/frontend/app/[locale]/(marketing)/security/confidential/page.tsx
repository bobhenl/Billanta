import type { Metadata } from 'next';
import { Check, EyeOff, ShieldCheck, TriangleAlert } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckList, NumberedSteps, PageIntro } from '@/components/learn-page';
import { LiveCsp } from '@/components/vault/live-csp';
import { VaultDemo } from '@/components/vault/vault-demo';
import { VaultIntegrity } from '@/components/vault/vault-integrity';
import { Link } from '@/i18n/navigation';
import { jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const PATH = '/security/confidential';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'securityPage' });
  return publicPageMetadata({ locale, path: PATH, title: t('seoTitle'), description: t('lead') });
}

/**
 * How Confidential mode keeps texts away from the server, shown rather than
 * claimed: a live demo that really posts an envelope (components/vault/
 * vault-demo.tsx), the page's own CSP header read back live, the build
 * hash manifest, and the limits in plain words.
 *
 * Only a WebPage node: the visible trail would be two rungs (home, this
 * page), which earns nothing, so there is no breadcrumb here or in the
 * markup.
 */
export default async function ConfidentialSecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('securityPage');

  return (
    <section className="container max-w-5xl py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(webPageLd(locale, PATH, 'WebPage', t('title'), t('lead')))} />
      <PageIntro eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')}>
        <Link href="/features" className={cn(buttonClass.secondary, 'px-6 py-3')}>
          {t('featuresLink')}
        </Link>
      </PageIntro>

      <h2 id="demo" className="mt-12 scroll-mt-20 text-xl font-bold tracking-tight">{t('demoTitle')}</h2>
      <p className="mb-4 mt-2 max-w-3xl text-sm text-muted-foreground">{t('demoLead')}</p>
      <VaultDemo />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('howTitle')}</h2>
      <NumberedSteps steps={t.raw('howSteps') as { title: string; body: string }[]} />

      <div id="server" className="mt-12 grid scroll-mt-20 gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <EyeOff className="h-4 w-4 text-primary" aria-hidden="true" />
            {t('hiddenTitle')}
          </h2>
          <CheckList className="mt-3" items={t.raw('hidden') as string[]} />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-bold">
            <Check className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t('visibleTitle')}
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {(t.raw('visible') as string[]).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <h2 id="csp" className="mt-12 scroll-mt-20 text-xl font-bold tracking-tight">{t('cspTitle')}</h2>
      <p className="mt-2 max-w-3xl text-sm">{t('cspBody')}</p>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{t('cspHow')}</p>
      <LiveCsp />

      <h2 className="mt-12 flex items-center gap-2 text-xl font-bold tracking-tight">
        <TriangleAlert className="h-5 w-5 text-warning" aria-hidden="true" />
        {t('limitsTitle')}
      </h2>
      <ul className="mt-4 max-w-3xl list-disc space-y-2 pl-5 text-sm">
        {(t.raw('limits') as string[]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 id="verify" className="mt-12 flex scroll-mt-20 items-center gap-2 text-xl font-bold tracking-tight">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        {t('verifyTitle')}
      </h2>
      <p className="mb-4 mt-2 max-w-3xl text-sm text-muted-foreground">{t('verifyLead')}</p>
      <VaultIntegrity />
      <ul className="mt-4 max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
        {(t.raw('planned') as string[]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
