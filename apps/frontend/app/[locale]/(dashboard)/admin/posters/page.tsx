import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { PosterSheet } from '@/components/poster-sheet';
import { PrintButton } from '@/components/print-button';
import { SettingsHeader } from '@/components/settings-header';
import { requirePlatformAdmin } from '@/lib/platform-admin';
import {
  parsePosterOptions,
  POSTER_LANGS,
  POSTER_SIZES,
  POSTER_TARGETS,
  POSTER_TEMPLATES,
  posterUrl,
  type PosterTarget
} from '@/lib/posters';
import { NOINDEX } from '@/lib/seo';
import { buttonClass, inputClass } from '@/lib/ui-classes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminPosters');
  return { title: t('title'), robots: NOINDEX };
}

/**
 * Prints only the sheet: everything that is not the sheet or one of its
 * ancestors disappears, and the ancestors lose their spacing, so the sheet
 * lands at the page's top-left corner at 100 %.
 */
function printCss(page: string): string {
  return `@page { size: ${page}; margin: 0; }
@media print {
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body *:not(:has(.poster-print)):not(.poster-print):not(.poster-print *) { display: none !important; }
  body *:has(.poster-print) { margin: 0 !important; padding: 0 !important; border: 0 !important; max-width: none !important; min-height: 0 !important; overflow: visible !important; position: static !important; box-shadow: none !important; background: none !important; }
}`;
}

/**
 * Billanta staff: print-ready posters and flyers for schools, creators,
 * events and municipal notice boards. Settings live in the URL, so a poster
 * can be sent to a colleague as a link and reprinted later.
 */
export default async function AdminPostersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePlatformAdmin();
  const locale = await getLocale();
  const t = await getTranslations('adminPosters');
  const o = parsePosterOptions(await searchParams, locale);

  const url = posterUrl(o);

  const field = 'flex flex-col gap-1 text-sm font-semibold';
  return (
    <div className="mx-auto max-w-6xl">
      <style dangerouslySetInnerHTML={{ __html: printCss(POSTER_SIZES[o.size].page) }} />
      <SettingsHeader title={t('title')} description={t('description')} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
        <form method="get" className="flex flex-col gap-4 self-start rounded-xl border border-border bg-card p-4">
          <input type="hidden" name="submitted" value="1" />
          <label className={field}>
            {t('fields.template')}
            <select name="template" defaultValue={o.template} className={inputClass}>
              {POSTER_TEMPLATES.map((v) => (
                <option key={v} value={v}>
                  {t(`templates.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('fields.lang')}
            <select name="lang" defaultValue={o.lang} className={inputClass}>
              {POSTER_LANGS.map((v) => (
                <option key={v} value={v}>
                  {t(`langs.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('fields.target')}
            <select name="target" defaultValue={o.target} className={inputClass}>
              {(Object.keys(POSTER_TARGETS) as PosterTarget[]).map((v) => (
                <option key={v} value={v}>
                  {t(`targets.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('fields.size')}
            <select name="size" defaultValue={o.size} className={inputClass}>
              {Object.keys(POSTER_SIZES).map((v) => (
                <option key={v} value={v}>
                  {t(`sizes.${v}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            {t('fields.promo')}
            <input name="promo" defaultValue={o.promo} maxLength={20} autoComplete="off" className={`${inputClass} font-mono uppercase`} />
          </label>
          <label className={field}>
            {t('fields.event')}
            <input name="event" defaultValue={o.event} maxLength={60} placeholder={t('eventPlaceholder')} className={inputClass} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="tabs" value="1" defaultChecked={o.tabs} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="font-semibold">{t('fields.tabs')}</span>
              <span className="block text-xs text-muted-foreground">{t('tabsHint')}</span>
            </span>
          </label>
          <button type="submit" className={buttonClass.secondary}>
            {t('apply')}
          </button>
        </form>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <PrintButton label={t('print')} />
            <p className="text-xs text-muted-foreground">{t('printHint')}</p>
          </div>
          <p className="mt-3 break-all text-sm">
            <span className="font-semibold">{t('qrTarget')}</span>{' '}
            <a href={url} target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">
              {url}
            </a>
          </p>
          <div className="mt-4 overflow-auto rounded-xl border border-border bg-muted p-4">
            <div className="poster-preview w-max shadow-lg">
              <PosterSheet options={o} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
