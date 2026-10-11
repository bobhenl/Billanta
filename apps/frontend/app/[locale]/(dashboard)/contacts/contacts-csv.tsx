'use client';

/**
 * Contacts CSV import/export buttons — adapted from faktorio's contact list
 * (https://github.com/capaj/faktorio, MIT © 2024-now Jiri Spac).
 */
import { useRef, useState } from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';

export type Skip = { line: number; reason: string; name: string };
type ImportResult = { created: number; updated: number; skipped: Skip[] };

const iconButton =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-semibold hover:bg-secondary disabled:opacity-60';

export function ContactsCsvButtons({ showExport, onSkipped }: { showExport: boolean; onSkipped: (rows: Skip[]) => void }) {
  const t = useTranslations('contacts.csv');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    onSkipped([]);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/contacts/import', { method: 'POST', body });
      const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
      if (!res.ok) {
        const known = ['unknown_columns', 'too_many_rows', 'no_file'];
        toast({ text: t(`errors.${known.includes(data.error ?? '') ? data.error : 'failed'}`), tone: 'err' });
        return;
      }
      toast({ text: t('done', { created: data.created ?? 0, updated: data.updated ?? 0 }), tone: 'ok' });
      onSkipped(data.skipped ?? []);
      router.refresh();
    } catch {
      toast({ text: t('errors.failed'), tone: 'err' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button type="button" className={iconButton} disabled={busy} onClick={() => input.current?.click()} title={t('importHint')}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {t('import')}
      </button>
      {showExport && (
        <a href="/api/files/contacts/export.csv" className={iconButton} download>
          <Download className="h-4 w-4" />
          {t('export')}
        </a>
      )}
    </>
  );
}

/** Rows the last import couldn't use, with their line in the file. */
export function SkippedRows({ rows }: { rows: Skip[] }) {
  const t = useTranslations('contacts.csv');
  if (rows.length === 0) return null;
  return (
    <Banner tone="warn" className="mt-3">
      <div>
        <p className="font-semibold">{t('skippedTitle', { count: rows.length })}</p>
        <ul className="mt-1 list-disc pl-5">
          {rows.slice(0, 10).map((s) => (
            <li key={s.line}>
              {t('skippedRow', { line: s.line, name: s.name || '–' })}: {t(`reasons.${s.reason}`)}
            </li>
          ))}
        </ul>
        {rows.length > 10 && <p className="mt-1">{t('skippedMore', { count: rows.length - 10 })}</p>}
      </div>
    </Banner>
  );
}
