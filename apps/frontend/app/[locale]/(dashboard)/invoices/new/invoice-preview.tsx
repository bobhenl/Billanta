import type { ReactNode } from 'react';

export interface PreviewLine {
  key: number;
  description: string;
  quantity: string;
  unit: string;
  total: string;
}

/**
 * A plain sketch of the document while it is typed: who, what, how much and
 * by when. It follows the form state only; the real layout (logo, QR, accent)
 * is the PDF's job.
 */
export function InvoicePreview({
  title,
  customerLines,
  dates,
  lines,
  totals,
  payment,
  noteAbove,
  noteBelow,
  labels
}: {
  title: string;
  customerLines: string[];
  dates: [string, string][];
  lines: PreviewLine[];
  totals: { label: string; value: string; strong?: boolean }[];
  payment: string[];
  noteAbove: string;
  noteBelow: string;
  labels: { customer: string; empty: string; noCustomer: string };
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-4 text-[11px] leading-snug">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-extrabold">{title}</p>
        <dl className="space-y-0.5 text-right text-muted-foreground">
          {dates.map(([k, v]) => (
            <div key={k}>
              {k} <span className="font-semibold tabular-nums text-foreground">{v}</span>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="font-bold uppercase tracking-wider text-muted-foreground">{labels.customer}</p>
        {customerLines.length > 0 ? (
          customerLines.map((l, i) => (
            <p key={i} className={i === 0 ? 'text-xs font-bold' : 'text-muted-foreground'}>
              {l}
            </p>
          ))
        ) : (
          <p className="text-muted-foreground">{labels.noCustomer}</p>
        )}
      </div>
      {noteAbove && <Note>{noteAbove}</Note>}
      {lines.length > 0 ? (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {lines.map((l) => (
            <li key={l.key} className="flex justify-between gap-3 py-1.5">
              <span className="min-w-0 break-words">
                {l.description}
                <span className="text-muted-foreground"> · {l.quantity}{l.unit ? ` ${l.unit}` : ' ×'}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{l.total}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-border/60 py-3 text-center text-muted-foreground">{labels.empty}</p>
      )}
      <dl className="ml-auto max-w-[14rem] space-y-0.5">
        {totals.map((row) => (
          <div key={row.label} className={row.strong ? 'flex justify-between pt-1 text-xs font-extrabold' : 'flex justify-between text-muted-foreground'}>
            <dt>{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {payment.length > 0 && <p className="text-muted-foreground">{payment.join(' · ')}</p>}
      {noteBelow && <Note>{noteBelow}</Note>}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="whitespace-pre-line text-muted-foreground">{children}</p>;
}
