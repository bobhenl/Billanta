'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import {
  CHECKLIST_COUNTRIES,
  CHECKLIST_CUSTOMERS,
  CHECKLIST_DOCUMENTS,
  VAT_STATUSES,
  lawUrl,
  type Checklist,
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistScenario
} from '@faktur/cz-compliance';
import { Segmented } from '@/components/public-tools/fields';
import { cn } from '@/lib/utils';

/**
 * Pieces shared by the invoice requirements checker and the ISDOC viewer:
 * the "who are you" picker, the situation notices and the grouped list of
 * items with their legal basis. Texts live in `tools.invoiceChecklist`.
 */

const GROUPS: ChecklistGroup[] = ['supplier', 'customer', 'document', 'amounts', 'payment'];

/** Whether the reverse-charge question means anything for this scenario. */
export const asksReverseCharge = (s: ChecklistScenario) => s.vatStatus === 'payer' && (s.customer === 'business' || s.customer === 'eu_business');

export function ScenarioPicker({ value, onChange }: { value: ChecklistScenario; onChange: (s: ChecklistScenario) => void }) {
  const t = useTranslations('tools.invoiceChecklist.scenario');
  const set = <K extends keyof ChecklistScenario>(key: K) => (v: ChecklistScenario[K]) => onChange({ ...value, [key]: v });
  const eu = value.customer === 'eu_business';
  return (
    <div className="space-y-4">
      <Segmented label={t('country')} value={value.country} onChange={set('country')} options={CHECKLIST_COUNTRIES.map((c) => ({ value: c, label: t(`countries.${c}`) }))} />
      <Segmented label={t('vatStatus')} value={value.vatStatus} onChange={set('vatStatus')} options={VAT_STATUSES.map((v) => ({ value: v, label: t(`vatStatuses.${v}`) }))} />
      <Segmented label={t('document')} value={value.document} onChange={set('document')} options={CHECKLIST_DOCUMENTS.map((d) => ({ value: d, label: t(`documents.${d}`) }))} />
      <Segmented label={t('customer')} value={value.customer} onChange={set('customer')} options={CHECKLIST_CUSTOMERS.map((c) => ({ value: c, label: t(`customers.${c}`) }))} />
      {asksReverseCharge(value) && (
        <Segmented
          label={eu ? t('euSupply') : t('reverseCharge')}
          value={value.reverseCharge ? 'yes' : 'no'}
          onChange={(v) => onChange({ ...value, reverseCharge: v === 'yes' })}
          options={[
            { value: 'yes', label: eu ? t('euService') : t('reverseYes') },
            { value: 'no', label: eu ? t('euGoods') : t('reverseNo') }
          ]}
        />
      )}
    </div>
  );
}

export function ChecklistNotices({ checklist }: { checklist: Checklist }) {
  const t = useTranslations('tools.invoiceChecklist');
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{checklist.taxDocument ? t('taxDocument') : t('notTaxDocument')}</p>
      {checklist.notices.map((n) => (
        <div key={n} className="flex gap-2.5 rounded-lg border border-border bg-secondary/60 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">{t(`notices.${n}`)}</p>
        </div>
      ))}
    </div>
  );
}

/** "§29/1a ZDPH" → "§ 29/1a ZDPH", as the laws are cited in print. */
const ruleText = (rule: string) => rule.replace(/^§\s*/, '§ ');

/** The items grouped by section; `leading` renders the checkbox or status icon of each row. */
export function ChecklistGroups({
  items,
  leading,
  rowClass,
  as = 'div'
}: {
  items: ChecklistItem[];
  leading: (item: ChecklistItem) => React.ReactNode;
  rowClass?: (item: ChecklistItem) => string | undefined;
  /** `label` makes the whole row toggle its checkbox. */
  as?: 'div' | 'label';
}) {
  const t = useTranslations('tools.invoiceChecklist');
  const Row = as;
  return (
    <div className="space-y-6">
      {GROUPS.map((g) => {
        const group = items.filter((i) => i.group === g);
        if (!group.length) return null;
        return (
          <section key={g}>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(`groups.${g}`)}</h3>
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
              {group.map((item) => {
                const url = lawUrl(item.rule);
                return (
                  <li key={item.id}>
                    <Row className={cn('flex gap-3 px-4 py-3', as === 'label' && 'cursor-pointer', rowClass?.(item))}>
                      <span className="mt-0.5 shrink-0">{leading(item)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{t(`items.${item.id}.label`)}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                          {item.note ? `${t(`notes.${item.note}`)} ` : ''}
                          {t(`items.${item.id}.hint`)}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 font-semibold',
                              item.level === 'required' ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'
                            )}
                          >
                            {t(`levels.${item.level}`)}
                          </span>
                          {item.rule &&
                            (url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
                                {ruleText(item.rule)}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">{ruleText(item.rule)}</span>
                            ))}
                        </span>
                      </span>
                    </Row>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
