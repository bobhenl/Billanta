import type { ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { DismissableDetails } from './dismissable-details';

/** Classes for the selects / inputs inside a filter panel. */
export const filterFieldClass = 'mt-1 block h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-primary';

/** A labelled field of the filter panel. */
export function FilterField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** An active filter shown next to the panel button, with a link that drops it. */
export interface FilterPill {
  key: string;
  label: string;
  removeHref: string;
}

/**
 * The "Filtry" panel shared by the list pages: a GET form, so the filters
 * live in the URL (shareable, back button works). `keep` are the filters
 * set elsewhere on the page (chips, search) that a submit must not drop;
 * `clearHref` is the page without the panel's own filters.
 *
 * Inline by default (opens under the button while filters are active).
 * With `modal`, the fields open in a dialog instead — for lists with many
 * filters — and the active ones show as removable pills beside the button.
 */
export async function FilterPanel({
  active,
  clearHref,
  keep,
  modal,
  pills,
  children
}: {
  active: number;
  clearHref: string;
  keep: Record<string, string | undefined>;
  modal?: boolean;
  pills?: FilterPill[];
  children: ReactNode;
}) {
  const t = await getTranslations('doc.filters');
  const summary = (
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-primary [&::-webkit-details-marker]:hidden">
      <SlidersHorizontal className="h-4 w-4" />
      {t('title')}
      {active > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">{active}</span>}
    </summary>
  );
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));
  const buttons = (
    <div className="flex gap-2">
      <button type="submit" className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
        {t('apply')}
      </button>
      {active > 0 && (
        <Link href={clearHref} className="rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent hover:text-primary">
          {t('clear')}
        </Link>
      )}
    </div>
  );

  if (!modal) {
    return (
      <details data-filter-panel className="group mt-3" open={active > 0}>
        {summary}
        <form action="" className="mt-2 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3">
          {hidden}
          {children}
          {buttons}
        </form>
      </details>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <DismissableDetails data-filter-panel>
        {summary}
        <div data-dismiss="self" className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <form
            action=""
            role="dialog"
            aria-modal="true"
            aria-label={t('title')}
            className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="inline-flex items-center gap-2 font-bold">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                {t('title')}
              </span>
              <button type="button" data-dismiss="button" aria-label={t('close')} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid flex-1 gap-x-4 gap-y-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3 [&_select]:w-full [&_input:not([type=hidden])]:min-w-0">
              {hidden}
              {children}
            </div>
            <div className="flex justify-end border-t border-border px-4 py-3">{buttons}</div>
          </form>
        </div>
      </DismissableDetails>
      {pills?.map((pill) => (
        <Link
          key={pill.key}
          href={pill.removeHref}
          title={t('remove')}
          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20"
        >
          {pill.label}
          <X className="h-3 w-3" aria-hidden />
        </Link>
      ))}
      {pills && pills.length > 1 && (
        <Link href={clearHref} className="px-1.5 text-xs font-semibold text-muted-foreground hover:text-primary">
          {t('clear')}
        </Link>
      )}
    </div>
  );
}

/** Two number inputs for an amount range. */
export function AmountRange({
  label,
  min,
  max,
  minLabel,
  maxLabel,
  names = ['amount_min', 'amount_max']
}: {
  label: React.ReactNode;
  min?: string;
  max?: string;
  minLabel: string;
  maxLabel: string;
  names?: [string, string];
}) {
  return (
    <div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          name={names[0]}
          min={0}
          step="any"
          inputMode="decimal"
          placeholder={minLabel}
          aria-label={minLabel}
          defaultValue={min}
          className={`${filterFieldClass} w-28`}
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="number"
          name={names[1]}
          min={0}
          step="any"
          inputMode="decimal"
          placeholder={maxLabel}
          aria-label={maxLabel}
          defaultValue={max}
          className={`${filterFieldClass} w-28`}
        />
      </div>
    </div>
  );
}

/** Parses a non-negative amount from the URL. */
export const amountParam = (value?: string) => (value && /^\d+([.,]\d+)?$/.test(value.trim()) ? value.trim().replace(',', '.') : undefined);
