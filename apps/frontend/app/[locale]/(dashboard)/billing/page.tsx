import { getTranslations } from 'next-intl/server';

// TODO: Stripe Customer Portal / plan + `subscription_status` display
// (blueprint §5) once billing endpoints and webhooks exist. Stubbed for
// now so the nav link resolves.
// When the subscribe button lands: show price, billing period, automatic
// renewal and how to cancel right next to it (California ARL, EU/CZ
// pre-contract information), and offer cancellation online in one step.
export default async function BillingPage() {
  const t = await getTranslations('billing');
  const tCommon = await getTranslations('common');

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('comingSoon')}</p>
      <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
        {tCommon('comingSoonBody')}
      </div>
    </div>
  );
}
