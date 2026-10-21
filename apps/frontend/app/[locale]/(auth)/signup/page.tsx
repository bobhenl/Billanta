import { cookies } from 'next/headers';
import { Gift, PackageOpen, Save, Ticket } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { DEMO_TRANSFER_COOKIE } from '@/lib/demo-session';
import { TRIAL_PLAN, trialDays } from '@/lib/plan';
import { PROMO_CODE, PROMO_COOKIE } from '@/lib/promo';
import { SignupForm } from './signup-form';

/**
 * Standalone signup page — picks up the "no standalone signup page built"
 * TODO from apps/frontend/README.md. Lives in an (auth) route group (no URL
 * segment added, same trick `(dashboard)` uses) so it renders without the
 * authenticated dashboard sidebar/shell from `(dashboard)/layout.tsx`.
 *
 * This page itself stays a plain server component with no interactivity —
 * all form state and the ToS acceptance logic live in the client component
 * below (`signup-form.tsx`), per blueprint §9's signup-gate requirement.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ promo?: string; for?: string; from?: string }> }) {
  const jar = await cookies();
  const query = await searchParams;
  // Came from the demo's "create an account": say that the work comes along.
  const fromDemo = jar.has(DEMO_TRANSFER_COOKIE);
  // Came from /create-invoice: the invoices kept in this browser come along on the welcome screen.
  const fromGuest = query.from === 'guest';
  // `?for=` from the accountants / schools pages pre-ticks the matching box.
  const audience = query.for === 'accountant' || query.for === 'teacher' ? query.for : null;
  // `?promo=` sets the cookie in this very response (middleware.ts), so read the query first.
  const queryPromo = query.promo?.trim();
  const promo = (queryPromo && PROMO_CODE.test(queryPromo) ? queryPromo.toUpperCase() : null) ?? jar.get(PROMO_COOKIE)?.value ?? null;
  const t = await getTranslations('demo.transfer');
  const tPromo = await getTranslations('promo');
  const tGuest = await getTranslations('guestInvoice.carryOver');
  const tSignup = await getTranslations('auth.signup');
  const tPricing = await getTranslations('pricing');
  const trial = trialDays();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        {trial > 0 && (
          <p className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm font-medium">
            <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {tSignup('trialNote', { days: trial, plan: tPricing(`plans.${TRIAL_PLAN}.name`) })}
          </p>
        )}
        {fromDemo && (
          <p className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
            <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {t('signupNote')}
          </p>
        )}
        {fromGuest && !fromDemo && (
          <p className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
            <Save className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {tGuest('signupNote')}
          </p>
        )}
        {promo && (
          <p className="mb-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
            <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {tPromo('signupNote', { code: promo })}
          </p>
        )}
        <SignupForm audience={audience} />
      </div>
    </div>
  );
}
