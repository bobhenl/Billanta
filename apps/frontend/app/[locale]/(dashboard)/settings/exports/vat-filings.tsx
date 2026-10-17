'use client';

import { useState } from 'react';
import { Download, Landmark, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { VAT_FORM_VERSIONS, VAT_INFO_CHECKED, VAT_OFFICIAL_URL } from '@faktur/cz-compliance';
import { Link } from '@/i18n/navigation';
import { inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';

const FILES = [
  { key: 'dp3', path: 'dphdp3.xml' },
  { key: 'kh1', path: 'dphkh1.xml' },
  { key: 'shv', path: 'dphshv.xml' }
] as const;

/**
 * VAT filings as EPO XML (přiznání, kontrolní hlášení, souhrnné hlášení),
 * fetched rather than linked so a "nothing to report" or missing-DIČ answer
 * shows as a toast instead of a downloaded error page.
 */
export function VatFilings() {
  const t = useTranslations('settings.exports.vat');
  const locale = useLocale();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [mode, setMode] = useState<'month' | 'quarter'>('month');
  const [year, setYear] = useState(String(prev.getFullYear()));
  const [month, setMonth] = useState(String(prev.getMonth() + 1));
  const [quarter, setQuarter] = useState(String(Math.floor(prev.getMonth() / 3) + 1));
  const [busy, setBusy] = useState<string | null>(null);
  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));
  const query = mode === 'month' ? `year=${year}&month=${month}` : `year=${year}&quarter=${quarter}`;

  async function download(key: string, path: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/files/exports/${path}?${query}`);
      if (!res.ok) {
        const reason =
          res.status === 404 ? t('nothingToReport') : res.status === 400 ? t('missingDic') : res.status === 503 ? t('rateUnavailable') : t('failed');
        toast({ text: reason, tone: res.status === 404 ? 'info' : 'err' });
        return;
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? path;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <Landmark className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h2 className="font-bold">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <select className={cn(inputClass, 'w-auto')} value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'quarter')}>
          <option value="month">{t('monthly')}</option>
          <option value="quarter">{t('quarterly')}</option>
        </select>
        <select className={cn(inputClass, 'w-auto')} value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        {mode === 'month' ? (
          <select className={cn(inputClass, 'w-auto')} value={month} onChange={(e) => setMonth(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, Number(m) - 1, 1).toLocaleDateString(locale, { month: 'long' })}
              </option>
            ))}
          </select>
        ) : (
          <select className={cn(inputClass, 'w-auto')} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {['1', '2', '3', '4'].map((q) => (
              <option key={q} value={q}>
                {t('quarter', { q })}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {FILES.map(({ key, path }) => (
          <button
            key={key}
            type="button"
            disabled={busy !== null}
            onClick={() => download(key, path)}
            className="flex flex-col rounded-lg border border-border p-4 text-left transition-colors hover:border-primary disabled:opacity-60"
          >
            <span className="font-semibold">{t(`files.${key}.title`)}</span>
            <span className="mt-1 flex-1 text-xs text-muted-foreground">{t(`files.${key}.hint`)}</span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {t('download')}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t('disclaimer')}</p>
      {/* Same constants the XML export (verzePis) and the public guide use. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {t('formVersions', {
          dp3: VAT_FORM_VERSIONS.DPHDP3,
          kh1: VAT_FORM_VERSIONS.DPHKH1,
          shv: VAT_FORM_VERSIONS.DPHSHV,
          date: new Date(`${VAT_INFO_CHECKED}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'Europe/Prague' })
        })}{' '}
        <a href={VAT_OFFICIAL_URL} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
          {t('officialLink')}
        </a>
        {' · '}
        <Link href="/navody/priznani-dph-kontrolni-a-souhrnne-hlaseni" locale={locale === 'en' ? 'en' : 'cs'} className="font-semibold text-primary hover:underline">
          {t('guideLink')}
        </Link>
      </p>
    </section>
  );
}
