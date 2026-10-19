'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { invoiceChecklist, type ChecklistCountry, type ChecklistItemId, type ChecklistScenario } from '@faktur/cz-compliance';
import { ChecklistGroups, ChecklistNotices, ScenarioPicker } from '@/components/public-tools/invoice-checklist-view';
import { buttonClass } from '@/lib/ui-classes';

/**
 * "What must my invoice contain?" The visitor says who they are and what
 * they issue, gets the items the law asks for in exactly that case, and
 * ticks off their own invoice. Ticks are kept when the scenario changes,
 * so switching e.g. to reverse charge only adds what is new.
 */
export function InvoiceRequirementsChecker({ defaultCountry }: { defaultCountry: ChecklistCountry }) {
  const t = useTranslations('tools.calculators.items.invoiceRequirements');
  const tc = useTranslations('tools.invoiceChecklist');
  const [scenario, setScenario] = useState<ChecklistScenario>({
    country: defaultCountry,
    vatStatus: 'payer',
    document: 'invoice',
    customer: 'business',
    reverseCharge: false
  });
  const [ticked, setTicked] = useState<Set<ChecklistItemId>>(new Set());
  const checklist = useMemo(() => invoiceChecklist(scenario), [scenario]);

  const required = checklist.items.filter((i) => i.level === 'required');
  const missing = required.filter((i) => !ticked.has(i.id));
  const done = required.length - missing.length;
  const toggle = (id: ChecklistItemId) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form className="h-fit space-y-4 rounded-xl border border-border bg-card p-5 lg:sticky lg:top-24" onSubmit={(e) => e.preventDefault()}>
        <h2 className="text-base font-semibold">{t('scenarioTitle')}</h2>
        {/* The normalised scenario, so impossible choices (a non-payer's simplified document) snap back. */}
        <ScenarioPicker value={{ ...scenario, ...checklist.scenario }} onChange={setScenario} />
      </form>

      <div className="min-w-0 space-y-6">
        <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold">{t('progressTitle')}</h2>
            <span className="text-sm tabular-nums text-muted-foreground">{t('progress', { done, total: required.length })}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={done}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} />
          </div>
          {missing.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              {t('allDone')}
            </p>
          ) : (
            <div className="mt-4 text-sm">
              <p className="font-medium">{t('missingTitle', { n: missing.length })}</p>
              <p className="mt-1 text-muted-foreground">{missing.map((i) => tc(`items.${i.id}.label`)).join(', ')}</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="flex-1 text-xs text-muted-foreground">{t('tickHint')}</p>
            {ticked.size > 0 && (
              <button type="button" className={buttonClass.ghost} onClick={() => setTicked(new Set())}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('reset')}
              </button>
            )}
          </div>
        </section>

        <ChecklistNotices checklist={checklist} />

        <ChecklistGroups
          items={checklist.items}
          as="label"
          leading={(item) => (
            <input
              type="checkbox"
              className="h-5 w-5 rounded border-input accent-[hsl(var(--primary))]"
              checked={ticked.has(item.id)}
              onChange={() => toggle(item.id)}
            />
          )}
          rowClass={(item) => (ticked.has(item.id) ? 'bg-secondary/40' : undefined)}
        />
      </div>
    </div>
  );
}
