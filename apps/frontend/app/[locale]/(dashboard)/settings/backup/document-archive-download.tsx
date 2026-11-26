'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * "Stáhnout archiv": a ZIP of the PDFs, ISDOC files, attachments and the
 * expense list for one year or all of them. A plain link, because the
 * backend streams the ZIP and the browser's own download handles a big one
 * better than a blob in memory.
 */
export function DocumentArchiveDownload({ years }: { years: number[] }) {
  const t = useTranslations('settings.backup.archive');
  const [year, setYear] = useState<string>(years[0] ? String(years[0]) : 'all');

  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      {years.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="archiveYear" className="sr-only">
            {t('yearLabel')}
          </label>
          <select id="archiveYear" value={year} onChange={(event) => setYear(event.target.value)} className={cn(inputClass, 'w-auto')}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="all">{t('allYears')}</option>
          </select>
          <a href={`/api/backup-destinations/archive?year=${encodeURIComponent(year)}`} download className={buttonClass.primary}>
            {t('download')}
          </a>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('contents')}</p>
    </section>
  );
}
