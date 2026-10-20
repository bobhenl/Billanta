import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { SettingsHeader } from '@/components/settings-header';
import { NotSignedInError } from '@/lib/api-client';
import { townCandidates } from '@/lib/business-directory';
import { getMunicipalityBySlug } from '@/lib/municipalities';
import { canManage, fetchMyRole, fetchTenant, type PublicProfileSettings, type TenantSettings } from '@/lib/tenant';
import { PublicProfileEditor } from './public-profile-editor';
import { settingsGate } from '@/components/settings-gate';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings.publicProfile');
  return { title: t('title') };
}

const SHOW_DEFAULTS: PublicProfileSettings['show'] = { email: true, phone: false, website: true, address: true, ico: true, logo: true };

/** "Novák & syn s.r.o." → "novak-syn". */
function suggestSlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(s\s*\.?\s*r\s*\.?\s*o|a\s*\.?\s*s|spol|v\s*\.?\s*o\s*\.?\s*s|k\s*\.?\s*s|z\s*\.?\s*s)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Settings → Veřejný profil: the company's public business-card page. */
export default async function PublicProfileSettingsPage() {
  const gate = await settingsGate('publicProfile');
  if (gate) return gate;
  const locale = await getLocale();
  const t = await getTranslations('settings.publicProfile');

  let tenant: TenantSettings | null;
  let role: string | null;
  try {
    [tenant, role] = await Promise.all([fetchTenant(), fetchMyRole()]);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect({ href: '/login', locale });
    return <Banner tone="err" title={t('loadError')} className="mt-6" />;
  }
  if (!tenant) return <Banner tone="err" title={t('loadError')} className="mt-6" />;

  const stored = tenant.publicProfile ?? {};
  const initial: PublicProfileSettings = {
    enabled: Boolean(stored.enabled),
    slug: stored.slug ?? null,
    tagline: stored.tagline ?? null,
    about: stored.about ?? null,
    services: stored.services ?? [],
    show: { ...SHOW_DEFAULTS, ...(stored.show ?? {}) },
    contactCta: stored.contactCta ?? true,
    orders: { enabled: false, customItems: false, prepay: false, ...(stored.orders ?? {}) },
    contactForm: stored.contactForm ?? false,
    directory: { enabled: false, trade: null, town: null, ...(stored.directory ?? {}) }
  };
  // Directory towns the company address can mean; the stored one stays pickable even after the address changed.
  const towns = townCandidates(tenant.addressCity, tenant.addressCountry);
  const storedTown = initial.directory.town ? getMunicipalityBySlug(initial.directory.town) : undefined;
  if (storedTown && !towns.some((c) => c.slug === storedTown.slug)) towns.push({ slug: storedTown.slug, name: storedTown.name, district: storedTown.district });

  return (
    <div className="mx-auto max-w-4xl">
      <SettingsHeader title={t('title')} description={t('description')} />
      {!canManage(role) && (
        <Banner tone="info" className="mt-4">
          {t('readOnly')}
        </Banner>
      )}
      <PublicProfileEditor
        initial={initial}
        readOnly={!canManage(role)}
        suggestedSlug={suggestSlug(tenant.companyName)}
        towns={towns}
        company={{ name: tenant.companyName, email: tenant.email, phone: tenant.phone, website: tenant.website, hasLogo: tenant.hasLogo, hasAddress: Boolean(tenant.addressStreet || tenant.addressCity), ico: tenant.ico, hasBankAccount: Boolean(tenant.bankAccountIban || tenant.bankAccountNumber) }}
      />
    </div>
  );
}
