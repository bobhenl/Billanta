import { getTranslations } from 'next-intl/server';

export default async function ClientPortalNotFound() {
  const t = await getTranslations('clientPortal');
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t('notFoundTitle')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('notFoundBody')}</p>
    </div>
  );
}
