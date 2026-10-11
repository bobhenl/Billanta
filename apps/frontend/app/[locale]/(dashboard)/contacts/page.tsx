import { getTranslations } from 'next-intl/server';

// TODO: replace with real contact list wired to `GET /api/v1/contacts`
// once the backend exists (blueprint §4 `contacts` table). Stubbed for
// now so the nav link resolves to a real route.
export default async function ContactsPage() {
  const t = await getTranslations('contacts');
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
