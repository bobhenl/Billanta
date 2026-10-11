import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { NotSignedInError } from '@/lib/api-client';
import { canManage, fetchMyAccess, fetchTenant } from '@/lib/tenant';
import { TOGGLEABLE_MODULES, type ModuleSet } from '@/lib/business-presets';
import { WelcomeSetup } from './welcome-setup';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('welcome');
  return { title: t('title') };
}

/** First screen after signup: a few questions that decide which parts of the app show up. */
export default async function WelcomePage() {
  const locale = await getLocale();
  try {
    const [access, tenant] = await Promise.all([fetchMyAccess(), fetchTenant()]);
    if (!canManage(access.role)) redirect({ href: '/dashboard', locale });
    const modules = Object.fromEntries(TOGGLEABLE_MODULES.map((m) => [m, access.modules[m]])) as ModuleSet;
    return (
      <WelcomeSetup
        initialModules={modules}
        company={{ ico: tenant?.ico ?? '', vatPayer: tenant?.dicVatPayer ?? false, country: tenant?.addressCountry ?? 'CZ' }}
      />
    );
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    redirect({ href: '/dashboard', locale });
  }
}
