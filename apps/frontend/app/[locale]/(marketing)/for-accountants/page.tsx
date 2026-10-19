import type { Metadata } from 'next';
import { Building2, Calculator, Check, FileDown, Gift, Link2, MapPin, MessageSquare, Sparkles, UserPlus, Users } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoCta } from '@/components/demo/demo-cta';
import { NextPages } from '@/components/learn-page';

import { EmbedSection } from '@/components/embed-section';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site';
import { REFERRAL_REWARDS } from '@/lib/referral';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'accountants' });
  return publicPageMetadata({ locale, path: '/for-accountants', title: t('seoTitle'), description: t('lead') });
}

/**
 * Partner programme for accountants and bookkeeping firms: what the
 * accountant role gives them in a client's company, the listing on the town
 * pages (opt-in via the public profile), the credits they earn per client
 * that starts paying (Settings → Invite for credits), and an invitation to
 * tell us what to build next. The FAQ is mirrored 1:1 in FAQPage data.
 */
export default async function AccountantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('accountants');
  const tLearn = await getTranslations('learnPages.common');
  const credits = REFERRAL_REWARDS.accountant;
  const faq = (t.raw('faq') as { q: string; a: string }[]).map(({ q, a }) => ({
    q,
    a: a.replace('{welcome}', String(credits.welcome)).replace('{reward}', String(credits.reward))
  }));
  const mailto = CONTACT_EMAIL ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('shapeCta.mailSubject'))}` : null;

  const benefits = [
    { icon: Users, key: 'access' },
    { icon: Building2, key: 'clients' },
    { icon: FileDown, key: 'exports' },
    { icon: MapPin, key: 'directory' },
    { icon: Gift, key: 'credits' },
    { icon: Sparkles, key: 'shape' }
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
        dangerouslySetInnerHTML={jsonLd([
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/for-accountants']
          ]),
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
          }
        ])}
      />
      <p className="text-sm font-bold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted-foreground sm:text-lg">{t('lead')}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/signup" className={buttonClass.primary}>
          {t('cta')}
        </Link>
        <Link href="/partners" className={buttonClass.secondary}>
          {t('partnersLink')}
        </Link>
      </div>
      <DemoCta view="accountant" className="mt-6 max-w-3xl" />

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{t('clients.title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('clients.lead')}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {(t.raw('clients.points') as string[]).map((p) => (
              <li key={p} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MapPin className="h-5 w-5" />
          </span>
          <h2 className="mt-3 text-xl font-bold tracking-tight">{t('directoryCta.title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('directoryCta.body')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/invoicing" className={buttonClass.secondary}>
              {t('directoryCta.example')}
            </Link>
            <Link href="/settings/public-profile" className={buttonClass.ghost}>
              {t('directoryCta.settings')}
            </Link>
          </div>
        </div>
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
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <MessageSquare className="h-5 w-5" />
        </span>
        <h2 className="mt-3 text-xl font-bold tracking-tight">{t('shapeCta.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-base">{t('shapeCta.body')}</p>
        <div className="mt-4">
          {mailto ? (
            <a href={mailto} className={buttonClass.primary}>
              {t('shapeCta.mail')}
            </a>
          ) : (
            <Link href="/signup" className={buttonClass.primary}>
              {t('shapeCta.signup')}
            </Link>
          )}
        </div>
      </div>

      <NextPages
        title={tLearn('nextTitle')}
        items={(['roles', 'owners', 'assistants', 'advanced'] as const).map((key) => ({
          href: { roles: '/team-roles', owners: '/for-owners', assistants: '/for-assistants', advanced: '/invoicing-for-advanced' }[key],
          title: tLearn(`pages.${key}.title`),
          body: tLearn(`pages.${key}.body`)
        }))}
      />

      <h2 className="mt-12 text-xl font-bold tracking-tight">{t('faqTitle')}</h2>
      <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {faq.map(({ q, a }) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer list-none font-semibold marker:hidden">{q}</summary>
            <p className="mt-2 text-sm text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>

      <EmbedSection section="accountants" tabs={['badge']} badgeKinds={['partner']} className="mt-12" />

      <div className="mt-12 rounded-xl border border-border p-6">
        <h2 className="text-lg font-bold tracking-tight">{t('fine.title')}</h2>
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
