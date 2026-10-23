'use client';

import { useId, type ReactNode } from 'react';
import { InfoHint } from '@/components/info-hint';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/** The card every calculator puts its form and its result in, so the pages read as one family. */
export const toolCard = 'min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5';

/**
 * Field label, with the secondary explanation behind an (i) when there is
 * one. Every field gets the same label row height, so inputs side by side
 * line up whether or not they have a note.
 */
function FieldLabel({ htmlFor, label, info }: { htmlFor: string; label: string; info?: ReactNode }) {
  const text = (
    <label htmlFor={htmlFor} className="text-sm font-medium">
      {label}
    </label>
  );
  return info ? <InfoHint hint={info}>{text}</InfoHint> : <div className="flex items-center">{text}</div>;
}

/** "1 200 000", "1200000,50" or "1.200.000" → number; empty or junk → 0. */
export function parseAmount(value: string): number {
  const cleaned = value.replace(/[\s ]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function money(locale: string, amount: number, currency = 'CZK', digits = 0): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

/** `unit` (CZK, EUR, %) sits inside the input on the right; `info` goes behind the (i), `hint` stays visible below. */
export function AmountField({
  label,
  value,
  onChange,
  hint,
  info,
  unit
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  info?: ReactNode;
  unit?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} info={info} />
      <div className="relative mt-1.5">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputClass, 'h-10 tabular-nums', unit && 'pr-14')}
        />
        {unit && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground" aria-hidden="true">
            {unit}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  info,
  placeholder,
  inputMode,
  type = 'text',
  maxLength
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  info?: ReactNode;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: 'text' | 'date';
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} info={info} />
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, 'mt-1.5 h-10')}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  info
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  info?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} info={info} />
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(inputClass, 'mt-1.5 h-10')}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Two-way toggle (e.g. actual / flat expenses, CZ / SK). */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="flex items-center text-sm font-medium">{label}</legend>
      {/* Three or more options stack on phones: wrapped rows of uneven pills read worse than a list. */}
      <div
        className={cn(
          'mt-1.5 rounded-lg border border-border bg-secondary p-0.5',
          options.length > 2 ? 'grid grid-cols-1 sm:flex sm:flex-wrap' : 'flex flex-wrap'
        )}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-h-[2.125rem] flex-auto rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              o.value === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** One label / value row of a result table. */
export function ResultRow({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2', strong && 'border-t border-border pt-3 text-base font-semibold')}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="text-right tabular-nums">
        {value}
        {note && <span className="block text-xs font-normal text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}
