import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { apiFetch, NotSignedInError } from '@/lib/api-client';
import { clientIp } from '@/lib/client-ip';
import { PROMO_CODE, PROMO_COOKIE } from '@/lib/promo';
import { lookupJoinCode } from '@/lib/promo-join';
import { canManage, fetchMyAccess, fetchTenant } from '@/lib/tenant';
import { BUSINESS_PRESETS, TOGGLEABLE_MODULES, type ModuleSet } from '@/lib/business-presets';
import { isSwitchBrand, SWITCH_COOKIE, switchBrandsFor } from '@/lib/switch';
import { WelcomeSetup } from './welcome-setup';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('welcome');
  return { title: t('title') };
}

/**
 * The business type of the join link the visitor came through: the code
 * still in the cookie, or one the dashboard redeemed in the last day (the
 * shell's PromoClaim may get there first and clear the cookie).
 */
async function promoPreset(): Promise<string | null> {
  const code = (await cookies()).get(PROMO_COOKIE)?.value;
  if (code && PROMO_CODE.test(code)) return (await lookupJoinCode(code, clientIp({ headers: await headers() })))?.businessPreset ?? null;
  const current = await apiFetch<{ redemption: { businessPreset: string | null; createdAt: string } | null }>('/api/v1/billing/promo-code').catch(() => null);
  const r = current?.redemption;
  return r && Date.now() - new Date(r.createdAt).getTime() < 24 * 60 * 60 * 1000 ? r.businessPreset : null;
}

/** First screen after signup: a few questions that decide which parts of the app show up. */
export default async function WelcomePage() {
  const locale = await getLocale();
  try {
    const [access, tenant, preset, jar] = await Promise.all([fetchMyAccess(), fetchTenant(), promoPreset(), cookies()]);
    // The app the visitor said they are leaving (a /switch page's signup link).
    const from = jar.get(SWITCH_COOKIE)?.value;
    if (!canManage(access.role)) redirect({ href: '/dashboard', locale });
    // Only preselected: nothing is saved until the visitor finishes the screen.
    const modules =
      BUSINESS_PRESETS.find((p) => p.key === preset)?.modules ??
      (Object.fromEntries(TOGGLEABLE_MODULES.map((m) => [m, access.modules[m]])) as ModuleSet);
    return (
      <WelcomeSetup
        initialModules={modules}
        company={{ ico: tenant?.ico ?? '', vatPayer: tenant?.dicVatPayer ?? false, country: tenant?.addressCountry ?? 'CZ' }}
        importApps={switchBrandsFor(locale)}
        initialImportFrom={isSwitchBrand(from) ? from : null}
      />
    );
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    redirect({ href: '/dashboard', locale });
  }
}
