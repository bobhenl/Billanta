import type { Metadata } from 'next';
import { Calculator, Check, FileDown, Gift, Link2, UserPlus, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';
import { REFERRAL_REWARDS } from '@/lib/referral';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'accountants' });
  return publicPageMetadata({ locale, path: '/pro-ucetni', title: t('seoTitle'), description: t('lead') });
}

/**
 * Partner programme for accountants and bookkeeping firms: what the
 * accountant role gives them in a client's company, and the credits they
 * earn per client that starts paying (Settings → Invite for credits).
 */
export default async function AccountantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('accountants');
  const credits = REFERRAL_REWARDS.accountant;

  const benefits = [
    { icon: Users, key: 'access' },
    { icon: FileDown, key: 'exports' },
    { icon: Gift, key: 'credits' }
  ] as const;
  const steps = [
    { icon: UserPlus, key: 'signup' },
    { icon: Calculator, key: 'program' },
    { icon: Link2, key: 'share' }
  ] as const;

  return (
    <section className="container max-w-5xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/pro-ucetni']
          ])
        )}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/signup" className={buttonClass.primary}>
          {t('cta')}
        </Link>
        <Link href="/partneri" className={buttonClass.secondary}>
          {t('partnersLink')}
        </Link>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {benefits.map(({ icon: Icon, key }) => (
          <div key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 font-bold">{t(`benefits.${key}.title`)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(`benefits.${key}.body`, { welcome: credits.welcome, reward: credits.reward })}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('stepsTitle')}</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-3">
        {steps.map(({ icon: Icon, key }, i) => (
          <li key={key} className="rounded-xl border border-border bg-card p-5">
            <span className="flex items-center gap-2 text-sm font-bold text-primary">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">{i + 1}</span>
              <Icon className="h-4 w-4" />
            </span>
            <h3 className="mt-3 font-bold">{t(`steps.${key}.title`)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${key}.body`)}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:p-8">
        <h2 className="text-xl font-bold tracking-tight">{t('fine.title')}</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {(t.raw('fine.points') as string[]).map((p) => (
            <li key={p} className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
