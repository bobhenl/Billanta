import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { SiteSearchBox } from '@/components/site-search-box';
import { searchSite, type SearchKind } from '@/lib/site-search';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'siteSearch' });
  // Result pages are thin and endless: never indexed, but the links are followed.
  return { title: t('title'), robots: { index: false, follow: true } };
}

/**
 * Search over the public site: pages, feature pages, every FAQ answer and
 * municipalities. Server-rendered GET form, so it works without JavaScript
 * and a result link can be shared.
 */
export default async function SiteSearchPage({
  params,
  searchParams
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q = '' } = await searchParams;
  const query = q.trim().slice(0, 100);
  const t = await getTranslations('siteSearch');
  const hits = query ? searchSite(locale, query) : [];

  return (
    <div className="container max-w-3xl py-12 sm:py-16">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <form action="" method="get" role="search" className="mt-5 flex gap-2">
        <SiteSearchBox key={query} defaultValue={query} />
        <button type="submit" className="rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90">
          {t('submit')}
        </button>
      </form>

      {query && (
        <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">
          {t('count', { count: hits.length, query })}
        </p>
      )}

      {hits.length > 0 ? (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
          {hits.map((hit, i) => (
            <li key={`${hit.href}-${i}`}>
              <Link href={hit.href} className="block px-4 py-3 transition-colors hover:bg-secondary">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t(`kind.${hit.kind as SearchKind}`)}</span>
                <span className="mt-0.5 block font-semibold text-foreground">{hit.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">{hit.snippet}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-6 text-sm text-muted-foreground">
          <p>{query ? t('empty') : t('suggestTitle')}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {(['isdoc', 'qr', 'dph', 'ares', 'banka', 'dobropis'] as const).map((s) => (
              <li key={s}>
                <Link href={{ pathname: '/search', query: { q: t(`suggest.${s}`) } }} className="inline-block rounded-full border border-border px-3 py-1 text-foreground hover:border-primary hover:text-primary">
                  {t(`suggest.${s}`)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
