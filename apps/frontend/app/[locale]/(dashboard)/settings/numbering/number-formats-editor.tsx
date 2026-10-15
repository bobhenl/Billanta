'use client';

import { useState, useTransition } from 'react';
import { Hash, Loader2, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  findNumberPatternClash,
  MAX_INVOICE_NUMBER_LENGTH,
  NUMBER_PATTERN_PRESETS,
  numberResetPeriod,
  renderDocumentNumber,
  validateNumberPattern,
  type NumberFormats
} from '@faktur/cz-compliance';
import { InfoHint } from '@/components/info-hint';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { updateNumberFormats, type NumberDocType, type NumberFormatsView } from '../actions';

type Row = NumberFormatsView['types'][number];

/** The proforma/credit note/quote prefix in front of a preset, so presets never clash with the invoice row. */
const PRESET_PREFIX: Record<NumberDocType, string> = { invoice: '', proforma: 'ZF', credit_note: 'OD', quote: 'NA' };

export function NumberFormatsEditor({ view }: { view: NumberFormatsView }) {
  const t = useTranslations('settings.numbering');
  const tDoc = useTranslations('doc');
  const router = useRouter();
  const [patterns, setPatterns] = useState<Record<string, string>>(() =>
    Object.fromEntries(view.types.map((r) => [r.type, r.pattern ?? r.defaultPattern]))
  );
  const [nextNumbers, setNextNumbers] = useState<Record<string, string>>({});
  const [saving, startSave] = useTransition();

  const effective = (r: Row) => patterns[r.type]?.trim() || r.defaultPattern;
  const formats: NumberFormats = Object.fromEntries(view.types.map((r) => [r.type, effective(r)]));
  const clash = findNumberPatternClash(formats);
  const errors = Object.fromEntries(view.types.map((r) => [r.type, validateNumberPattern(effective(r))]));
  const nextOf = (r: Row) => {
    const raw = nextNumbers[r.type]?.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= 999_999 ? n : NaN;
  };
  const invalid = clash !== null || view.types.some((r) => errors[r.type] || Number.isNaN(nextOf(r)));
  const dirty = view.types.some((r) => effective(r) !== (r.pattern ?? r.defaultPattern) || nextOf(r) !== null);

  const save = () =>
    startSave(async () => {
      const result = await updateNumberFormats({
        formats: Object.fromEntries(view.types.map((r) => [r.type, effective(r) === r.defaultPattern ? null : effective(r)])),
        nextNumbers: Object.fromEntries(view.types.flatMap((r) => (nextOf(r) ? [[r.type, nextOf(r)!]] : [])))
      });
      if (result.ok) {
        toast({ text: t('saved'), tone: 'ok' });
        setNextNumbers({});
        router.refresh();
      } else {
        const known = ['pattern_clash', 'next_number_too_low'].includes(result.error);
        toast({ text: known ? t(`errors.${result.error}`) : `${t('saveFailed')}: ${result.error}`, tone: 'err' });
      }
    });

  return (
    <>
      <div className="mt-6 space-y-4">
        {view.types.map((r) => {
          const pattern = effective(r);
          const error = errors[r.type];
          const reset = error ? r.reset : numberResetPeriod(pattern);
          const last = reset === 'monthly' ? r.lastMonthly : r.lastYearly;
          const next = nextOf(r);
          // The server's preview already steps over numbers that exist; use it while nothing changed.
          const unchanged = pattern === (r.pattern ?? r.defaultPattern) && next === null;
          const sequence = next && !Number.isNaN(next) ? next : unchanged && r.nextSequence ? r.nextSequence : last + 1;
          const sample = (seq: number) => renderDocumentNumber(pattern, { year: view.year, month: view.month, sequence: seq });
          const preview = error ? null : sample(sequence);
          const prefix = PRESET_PREFIX[r.type];
          const presets = NUMBER_PATTERN_PRESETS.map((p) => (prefix && p.startsWith('FV') ? prefix + p.slice(2) : prefix + p));
          return (
            <section key={r.type} className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 font-bold">
                <Hash className="h-4 w-4 text-primary" />
                {tDoc(`type.${r.type}`)}
              </h2>

              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                <label className="block space-y-1">
                  <InfoHint hint={t('patternHint')} className="text-xs text-muted-foreground">
                    {t('pattern')}
                  </InfoHint>
                  <input
                    value={patterns[r.type] ?? ''}
                    onChange={(e) => setPatterns((all) => ({ ...all, [r.type]: e.target.value }))}
                    maxLength={64}
                    placeholder={r.defaultPattern}
                    aria-invalid={Boolean(error) || clash === r.type}
                    className={cn(inputClass, 'font-mono', (error || clash === r.type) && 'border-destructive')}
                  />
                </label>
                <label className="block space-y-1">
                  <InfoHint hint={t('nextNumberHint')} className="text-xs text-muted-foreground">
                    {t('nextNumber')}
                  </InfoHint>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={999999}
                    value={nextNumbers[r.type] ?? ''}
                    onChange={(e) => setNextNumbers((all) => ({ ...all, [r.type]: e.target.value }))}
                    placeholder={String(last + 1)}
                    aria-invalid={Number.isNaN(next)}
                    className={cn(inputClass, Number.isNaN(next) && 'border-destructive')}
                  />
                </label>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPatterns((all) => ({ ...all, [r.type]: p }))}
                    className={cn(
                      'rounded-full border px-2.5 py-1 font-mono text-xs transition-colors hover:border-primary hover:text-primary',
                      pattern === p ? 'border-primary text-primary' : 'border-border bg-background'
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                {error ? (
                  <p className="text-destructive">{t(`errors.${error}`, { max: MAX_INVOICE_NUMBER_LENGTH })}</p>
                ) : clash === r.type ? (
                  <p className="text-destructive">{t('errors.pattern_clash')}</p>
                ) : (
                  <>
                    <p>
                      {t('preview')} <span className="font-mono font-bold">{preview}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        {t('then', { number: sample(sequence + 1) })}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(reset === 'monthly' ? 'resetMonthly' : 'resetYearly')} {t('lastUsed', { number: last })}
                    </p>
                    {next !== null && !Number.isNaN(next) && next <= last && <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">{t('lowerWarning')}</p>}
                  </>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={save} disabled={saving || invalid || !dirty} className={buttonClass.primary}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t('save')}
        </button>
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="font-bold">{t('tokensTitle')}</h2>
        <ul className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          {(['YYYY', 'YY', 'MM', 'N', 'NNNN'] as const).map((token) => (
            <li key={token}>
              <span className="font-mono text-foreground">{`{${token}}`}</span> – {t(`tokens.${token}`)}
            </li>
          ))}
        </ul>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t('how.rules')}</li>
          <li>{t('how.reset')}</li>
          <li>{t('how.issued')}</li>
          <li>{t('how.separate')}</li>
        </ul>
      </section>
    </>
  );
}
