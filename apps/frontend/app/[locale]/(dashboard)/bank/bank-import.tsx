'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, UploadCloud } from 'lucide-react';
import { InfoHint } from '@/components/info-hint';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from '@/components/toaster';

/** "Nahrát výpis" — posts the CSV through `/api/bank/import`, then refreshes the list. */
export function BankImport() {
  const t = useTranslations('bank.import');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ text: t('invalidFile'), tone: 'err' });
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/bank/import', { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as { summary?: { total: number; matched: number }; message?: unknown };
      if (!res.ok || !json.summary) {
        const message = Array.isArray(json.message) ? json.message.join(', ') : String(json.message ?? `HTTP ${res.status}`);
        toast({ text: t('parseError', { message }), tone: 'err' });
        return;
      }
      toast({ text: t('success', json.summary), tone: 'ok' });
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
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
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? t('importing') : t('submit')}
      </button>
      <InfoHint
        label={t('formatHelpLabel')}
        rowClassName="justify-end"
        bodyClassName="max-w-xs text-left"
        hint={
          <>
            {t('formatHelp')}{' '}
            <a href="/samples/bank-statement-sample.csv" download className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              <Download className="h-3 w-3" aria-hidden="true" />
              {t('sample')}
            </a>
          </>
        }
      >
        <span className="text-[11px] text-muted-foreground">{t('formatHelpLabel')}</span>
      </InfoHint>
    </div>
  );
}
