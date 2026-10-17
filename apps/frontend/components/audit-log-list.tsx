'use client';

import { useState, useTransition } from 'react';
import { Bot, KeyRound, Server, User, UserPen } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { fetchAuditLog, type AuditChange, type AuditEntityType, type AuditItem, type AuditPage } from '@/lib/audit';

const FILTERS: (AuditEntityType | 'all')[] = ['all', 'invoice', 'contact', 'tenant', 'bank_account', 'member', 'api_key'];
const MONEY_FIELDS = new Set(['amountPaid', 'total', 'exchangeRate']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
/** Date-only columns come back as midnight UTC; they have no time worth showing. */
const MIDNIGHT = /T00:00:00(\.000)?Z$/;

export type AuditMember = { userId: string; name: string | null; email: string };
type Filters = { entity: AuditEntityType | 'all'; action: string; userId: string; from: string; to: string };

/** Where an entry links to; nothing for deleted records. */
function hrefOf(item: AuditItem): string | null {
  if (item.action === 'deleted' && item.entityType !== 'bank_account') return null;
  switch (item.entityType) {
    case 'invoice':
      return item.entityId ? `/invoices/${item.entityId}` : null;
    case 'contact':
      return item.entityId ? `/contacts/${item.entityId}` : null;
    case 'tenant':
    case 'bank_account':
      return '/settings/company';
    case 'member':
      return '/settings/team';
    case 'api_key':
      return '/settings/api-keys';
  }
}

/**
 * Historie změn: who changed what and when, field by field (old → new),
 * with the reason given for editing an issued document. Used by the
 * global /activity page (with entity filters) and, scoped to one record,
 * on a document's detail. "Load more" pages with `before`.
 */
export function AuditLogList({
  initial,
  entityType,
  entityId,
  showFilters = false,
  compact = false,
  members = []
}: {
  initial: AuditPage;
  entityType?: AuditEntityType;
  entityId?: string;
  showFilters?: boolean;
  /** On a document's own page: no entity name on every row. */
  compact?: boolean;
  /** For the member filter on the global page. */
  members?: AuditMember[];
}) {
  const t = useTranslations('audit');
  const format = useFormatter();
  const [filters, setFilters] = useState<Filters>({ entity: entityType ?? 'all', action: '', userId: '', from: '', to: '' });
  const [page, setPage] = useState(initial);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = (f: Filters, before?: string) =>
    startTransition(async () => {
      const res = await fetchAuditLog({
        entityType: f.entity === 'all' ? undefined : f.entity,
        entityId,
        before,
        action: f.action || undefined,
        userId: f.userId || undefined,
        from: f.from || undefined,
        to: f.to || undefined
      });
      if (!res) return setError(true);
      setError(false);
      setPage((prev) => (before ? { items: [...prev.items, ...res.items], hasMore: res.hasMore } : res));
    });

  const apply = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    load(next);
  };
  const control = 'h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:w-auto';

  const label = (namespace: string, key: string, fallback: string) => (t.has(`${namespace}.${key}`) ? t(`${namespace}.${key}`) : fallback);

  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'boolean') return v ? t('yes') : t('no');
    if (MONEY_FIELDS.has(field) && !Number.isNaN(Number(v))) return format.number(Number(v), { minimumFractionDigits: 2, maximumFractionDigits: field === 'exchangeRate' ? 4 : 2 });
    if (typeof v === 'string' && ISO_DATE.test(v)) {
      const d = new Date(v);
      return v.length > 10 && !MIDNIGHT.test(v)
        ? format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
        : format.dateTime(d, { dateStyle: 'medium', timeZone: 'UTC' });
    }
    if (typeof v === 'string') return t.has(`values.${v}`) ? t(`values.${v}`) : v;
    if (Array.isArray(v)) return v.map((x) => value(field, x)).join(', ');
    return JSON.stringify(v);
  };

  const changeRow = (c: AuditChange) => {
    const name = label('fields', c.field, c.field);
    // Settings objects, secrets and links to other records: only "it changed".
    if ((c.from === null && c.to === null) || /Id$/.test(c.field)) return <>{name}: <span className="text-muted-foreground">{t('changed')}</span></>;
    if (Array.isArray(c.from) || Array.isArray(c.to)) {
      const from = (c.from as string[] | null) ?? [];
      const to = (c.to as string[] | null) ?? [];
      const removed = from.filter((x) => !to.includes(x));
      const added = to.filter((x) => !from.includes(x));
      return (
        <>
          {name}:
          <ul className="mt-0.5 space-y-0.5">
            {removed.map((x, i) => (
              <li key={`r${i}`} className="text-destructive line-through decoration-destructive/50">− {x}</li>
            ))}
            {added.map((x, i) => (
              <li key={`a${i}`} className="text-emerald-700 dark:text-emerald-400">+ {x}</li>
            ))}
            {removed.length === 0 && added.length === 0 && <li className="text-muted-foreground">{t('reordered')}</li>}
          </ul>
        </>
      );
    }
    if (c.from === null) return <>{name}: <strong className="font-semibold">{value(c.field, c.to)}</strong></>;
    if (c.to === null || c.to === '')
      return (
        <>
          {name}: <span className="text-muted-foreground line-through decoration-muted-foreground/50">{value(c.field, c.from)}</span>{' '}
          <span className="text-muted-foreground">({t('cleared')})</span>
        </>
      );
    return (
      <>
        {name}: <span className="text-muted-foreground line-through decoration-muted-foreground/50">{value(c.field, c.from)}</span> →{' '}
        <strong className="font-semibold">{value(c.field, c.to)}</strong>
      </>
    );
  };

  const actor = (item: AuditItem) => {
    if (item.actor === 'ai') return { icon: Bot, name: t('actor.ai') };
    if (item.actor === 'api_key') return { icon: KeyRound, name: t('actor.api_key') };
    if (item.actor === 'system') return { icon: Server, name: t('actor.system') };
    if (item.actor === 'customer') return { icon: UserPen, name: t('actor.customer') };
    return { icon: User, name: item.userName || item.userEmail || t('actor.user') };
  };

  const actionLabel = (item: AuditItem) => {
    if (item.action.startsWith('converted_')) return t('actions.converted', { to: label('docTypes', item.action.slice(10), item.action.slice(10)) });
    return label(`actions.${item.entityType}`, item.action, label('actions.any', item.action, item.action));
  };

  return (
    <div>
      {showFilters && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('filterLabel')}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filters.entity === f}
                onClick={() => apply({ entity: f, action: '' })}
                className={`rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
                  filters.entity === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary hover:text-primary'
                }`}
              >
                {t(`entities.${f}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
            {filters.entity !== 'all' && (
              <label className="col-span-2 space-y-1 sm:col-span-1">
                <span className="block text-xs font-medium text-muted-foreground">{t('filters.action')}</span>
                <select value={filters.action} onChange={(e) => apply({ action: e.target.value })} className={control}>
                  <option value="">{t('filters.anyAction')}</option>
                  {Object.entries(t.raw(`actions.${filters.entity}`) as Record<string, string>).map(([key, text]) => (
                    <option key={key} value={key}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {members.length > 1 && (
              <label className="col-span-2 space-y-1 sm:col-span-1">
                <span className="block text-xs font-medium text-muted-foreground">{t('filters.member')}</span>
                <select value={filters.userId} onChange={(e) => apply({ userId: e.target.value })} className={control}>
                  <option value="">{t('filters.anyMember')}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">{t('filters.from')}</span>
              <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => apply({ from: e.target.value })} className={control} />
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium text-muted-foreground">{t('filters.to')}</span>
              <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => apply({ to: e.target.value })} className={control} />
            </label>
            {(filters.entity !== 'all' || filters.action || filters.userId || filters.from || filters.to) && (
              <button
                type="button"
                onClick={() => apply({ entity: 'all', action: '', userId: '', from: '', to: '' })}
                className="col-span-2 h-9 rounded-lg px-3 text-sm font-semibold text-primary hover:underline sm:col-span-1"
              >
                {t('filters.reset')}
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive">{t('loadError')}</p>}

      {page.items.length === 0 ? (
        <p className={`${showFilters ? 'mt-6' : ''} text-sm text-muted-foreground`}>{t('empty')}</p>
      ) : (
        <ol className={`${showFilters ? 'mt-4' : ''} divide-y divide-border rounded-xl border border-border bg-card ${pending ? 'opacity-60' : ''}`}>
          {page.items.map((item) => {
            const who = actor(item);
            const href = hrefOf(item);
            return (
              <li key={item.id} className="flex gap-3 p-3 sm:p-4">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <who.icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="font-semibold">{who.name}</span>
                    <span>{actionLabel(item)}</span>
                    {!compact && (item.entityLabel || item.entityType === 'tenant') && (
                      href ? (
                        <Link href={href} className="font-semibold text-primary hover:underline">
                          {item.entityLabel ?? t('entities.tenant')}
                        </Link>
                      ) : (
                        <span className="font-semibold">{item.entityLabel ?? t('entities.tenant')}</span>
                      )
                    )}
                    <time dateTime={item.createdAt} className="ml-auto text-xs text-muted-foreground">
                      {format.dateTime(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
                    </time>
                  </p>
                  {item.reason && (
                    <p className="mt-1 rounded-md border-l-2 border-amber-500 bg-amber-500/10 px-2 py-1 text-xs">
                      <span className="font-semibold">{t('reason')}:</span> {item.reason}
                    </p>
                  )}
                  {item.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 break-words text-xs">
                      {item.changes.map((c, i) => (
                        <li key={i}>{changeRow(c)}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {page.hasMore && (
        <button
          type="button"
          disabled={pending}
          onClick={() => load(filters, page.items[page.items.length - 1]?.createdAt)}
          className="mt-3 w-full rounded-lg border border-border bg-card py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
        >
          {pending ? t('loading') : t('loadMore')}
        </button>
      )}
    </div>
  );
}
