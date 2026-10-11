'use client';

import { useMemo, useState, useTransition } from 'react';
import { Loader2, Search, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { Contact } from '../new/types';
import type { SavedTemplateRow } from '../templates/template-gallery';
import { bulkInvoice } from '../templates/actions';

const MAX_CONTACTS = 200;

export function BulkForm({
  templates,
  contacts,
  initialTemplateId
}: {
  templates: SavedTemplateRow[];
  contacts: (Contact & { isStarred?: boolean })[];
  initialTemplateId: string | null;
}) {
  const t = useTranslations('bulk');
  const tDoc = useTranslations('doc');
  const locale = useLocale();
  const router = useRouter();
  const [templateId, setTemplateId] = useState(initialTemplateId ?? templates[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issue, setIssue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const template = templates.find((tpl) => tpl.id === templateId) ?? null;
  const net = useMemo(
    () =>
      (template?.lineItems ?? []).reduce(
        (sum, i) => sum + Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discountPercent ?? 0) / 100),
        0
      ),
    [template]
  );
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: template?.currency || 'CZK' });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? contacts.filter((c) => [c.legalName, c.ico, c.email, c.addressCity].some((v) => v?.toLowerCase().includes(q)))
      : contacts;
    return [...list].sort((a, b) => Number(Boolean(b.isStarred)) - Number(Boolean(a.isStarred)) || a.legalName.localeCompare(b.legalName, locale));
  }, [contacts, query, locale]);

  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const c of visible) {
        if (allVisibleSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  const submit = () => {
    setError(null);
    if (!template) return setError(t('errors.template'));
    if (selected.size === 0) return setError(t('errors.contacts'));
    if (selected.size > MAX_CONTACTS) return setError(t('errors.tooMany', { max: MAX_CONTACTS }));
    start(async () => {
      const result = await bulkInvoice(template.id, [...selected], issueDate, issue);
      if (!result.ok) {
        setError(t('errors.failed', { reason: result.error }));
        return;
      }
      toast({ text: issue ? t('doneIssued', { count: result.data.count }) : t('doneDrafts', { count: result.data.count }), tone: 'ok' });
      router.push('/invoices');
    });
  };

  const label = 'text-xs font-bold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className={label}>{t('step1')}</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {templates.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setTemplateId(tpl.id)}
              aria-pressed={tpl.id === templateId}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors',
                tpl.id === templateId ? 'border-primary bg-accent/50 ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
              )}
            >
              <span className="block truncate font-bold">{tpl.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {tDoc(`type.${tpl.documentType}`)} · {t('itemsCount', { count: tpl.lineItems.length })}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={label}>{t('step2')}</h2>
          <span className="text-sm font-semibold text-primary">{t('selectedCount', { count: selected.size })}</span>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(inputClass, 'pl-9')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} />
        </div>
        {contacts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noContacts')}</p>
        ) : (
          <>
            <label className="mt-3 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} className="h-4 w-4 accent-primary" />
              {t('selectAll', { count: visible.length })}
            </label>
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {visible.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2 text-sm hover:bg-secondary/50">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-primary" />
                    {c.isStarred && <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{c.legalName}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {[c.ico && `IČO ${c.ico}`, c.email ?? t('noEmail')].filter(Boolean).join(' · ')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className={label}>{t('step3')}</h2>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('issueDate')}</span>
            <input type="date" className={cn(inputClass, 'w-44')} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={issue} onChange={(e) => setIssue(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="font-medium">{t('issueNow')}</span>
              <span className="block text-xs text-muted-foreground">{t('issueNowHint')}</span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm">
            {t.rich('summary', {
              count: selected.size,
              total: money.format(net * selected.size),
              b: (chunks) => <strong>{chunks}</strong>
            })}
          </p>
          <button type="button" className={buttonClass.primary} disabled={busy || selected.size === 0 || !template} onClick={submit}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {issue ? t('submitIssue', { count: selected.size }) : t('submitDrafts', { count: selected.size })}
          </button>
        </div>
        {error && (
          <Banner tone="err" className="mt-3">
            {error}
          </Banner>
        )}
      </section>
    </div>
  );
}
