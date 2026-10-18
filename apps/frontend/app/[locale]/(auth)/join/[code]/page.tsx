import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Mail, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Link, redirect } from '@/i18n/navigation';
import { OAuthButton } from '@/components/oauth-button';
import { clientIp } from '@/lib/client-ip';
import { demoEnabled } from '@/lib/demo';
import { enabledOAuthProviders, PROVIDER_NAMES } from '@/lib/oauth-providers';
import { PROMO_CODE } from '@/lib/promo';
import { lookupJoinCode } from '@/lib/promo-join';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { JoinCodeForm } from '../join-code-form';
import { JoinDemoButton } from './join-demo-button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('join');
  return { title: t('metaTitle') };
}

/**
 * The group join link (`/join/KAVARNA-BRNO`, usually from a QR code): one
 * screen for a whole event, coworking or class. Middleware has already put
 * the code into the promo cookie, so whichever way the visitor signs up, the
 * new company redeems it, and /welcome preselects the code's business type.
 */
export default async function JoinCodePage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const [{ locale, code: raw }, { auto }] = await Promise.all([params, searchParams]);
  const info = PROMO_CODE.test(raw) ? await lookupJoinCode(raw.toUpperCase(), clientIp({ headers: await headers() })) : null;
  // An unprefixed link from a visitor who never picked a language opens in the code's own one.
  if (info?.defaultLocale && auto && info.defaultLocale !== locale) redirect({ href: `/join/${info.code}`, locale: info.defaultLocale });

  const t = await getTranslations('join');
  if (!info) {
    return (
      <Shell>
        <h1 className="text-xl font-bold">{t('form.title')}</h1>
        <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {t('invalid')}
        </p>
        <div className="mt-5">
          <JoinCodeForm defaultValue={raw.slice(0, 32)} />
        </div>
      </Shell>
    );
  }

  const [tPromo, tPlan, tModules, tLogin, session] = await Promise.all([
    getTranslations('promo'),
    getTranslations('billing.planNames'),
    getTranslations('settings.modules'),
    getTranslations('auth.login'),
    auth().catch(() => null)
  ]);
  const benefit = tPromo(`benefit.${info.benefitType}`, { count: info.benefitValue, plan: tPlan(info.benefitPlan) });
  const preset = info.businessPreset && tModules.has(`presets.${info.businessPreset}.title`) ? info.businessPreset : null;
  const signedIn = Boolean(session?.user) && !session?.isDemo;

  return (
    <Shell>
      <p className="text-sm font-semibold text-primary">{info.ownerLabel ? t('from', { owner: info.ownerLabel }) : t('fromBillanta')}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
        {t('benefit', { benefit })}
        {preset && <> {t('preset', { preset: tModules(`presets.${preset}.title`) })}</>}
      </p>

      {signedIn ? (
        <div className="mt-6">
          <p className="text-sm text-muted-foreground">{t('signedIn')}</p>
          <Link href="/dashboard" className={cn(buttonClass.primary, 'mt-3 w-full')}>
            {t('toDashboard')}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-2">
          {enabledOAuthProviders().map((id) => (
            <OAuthButton key={id} provider={id} label={tLogin('continueWith', { provider: PROVIDER_NAMES[id] })} callbackUrl="/welcome" />
          ))}
          <Link href="/signup" className={cn(buttonClass.primary, 'w-full')}>
            <Mail className="h-4 w-4" aria-hidden="true" />
            {t('email')}
          </Link>
          {demoEnabled() && (
            <>
              <div className="my-2 flex items-center gap-3 text-xs uppercase text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t('or')}
                <span className="h-px flex-1 bg-border" />
              </div>
              <JoinDemoButton preset={preset} locale={locale} />
              <p className="text-center text-xs text-muted-foreground">{t('tryHint')}</p>
            </>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {t('remembered', { code: info.code })}{' '}
        {!signedIn && (
          <Link href="/login" className="font-medium text-foreground underline underline-offset-2 hover:no-underline">
            {t('haveAccount')}
          </Link>
        )}
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <Ticket className="mb-3 h-6 w-6 text-primary" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
