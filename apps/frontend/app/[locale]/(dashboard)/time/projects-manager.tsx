'use client';

import { useEffect, useState, useTransition } from 'react';
import { Archive, ArchiveRestore, FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { ColorDot } from '@/components/color-dot';
import { InfoHint } from '@/components/info-hint';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { formatMoney } from '@/lib/invoice-ui';
import { formatMinutes, type Project } from '@/lib/time-ui';
import { cn } from '@/lib/utils';
import { createProject, deleteProject, updateProject, type ProjectInput } from './actions';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
const CURRENCIES = ['CZK', 'EUR', 'USD', 'GBP', 'PLN'];
const field = 'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const label = 'mb-1 block text-xs font-semibold text-muted-foreground';

/** Projects: customer, hourly rate, colour; archive or delete. */
export function ProjectsManager({ projects, contacts, home = 'CZK' }: { projects: Project[]; contacts: { id: string; name: string }[]; home?: string }) {
  const t = useTranslations('time');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const canEdit = useCanWrite('invoices');
  const [form, setForm] = useState<Required<Omit<ProjectInput, 'archived' | 'hourly_rate'>>>({ name: '', contact_id: null, currency: home, color: COLORS[0] ?? null });
  const [rate, setRate] = useState('');

  useEffect(() => {
    if (!editing) return;
    const p = editing === 'new' ? null : editing;
    setForm({
      name: p?.name ?? '',
      contact_id: p?.contactId ?? null,
      currency: p?.currency ?? home,
      color: p?.color ?? COLORS[projects.length % COLORS.length] ?? null
    });
    setRate(p?.hourlyRate ? String(Number(p.hourlyRate)) : '');
  }, [editing, projects.length, home]);
  const payload = (): ProjectInput => ({ ...form, name: form.name.trim(), hourly_rate: rate ? Number(rate.replace(',', '.')) : null });

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okText: string, after?: () => void) =>
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast({ text: r.error, tone: 'err' });
        return;
      }
      toast({ text: okText, tone: 'ok' });
      after?.();
      router.refresh();
    });

  const visible = projects.filter((p) => showArchived || !p.archived);
  const archivedCount = projects.filter((p) => p.archived).length;

  return (
    <section id="projects" className="mt-8 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <FolderKanban className="h-5 w-5 text-primary" />
          {t('projects.title')}
        </h2>
        <div className="flex items-center gap-2">
          {archivedCount > 0 && (
            <button type="button" onClick={() => setShowArchived((v) => !v)} className="text-xs font-semibold text-muted-foreground hover:text-primary">
              {showArchived ? t('projects.hideArchived') : t('projects.showArchived', { count: archivedCount })}
            </button>
          )}
          {canEdit && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-accent hover:text-primary"
          >
            <Plus className="h-4 w-4" />
            {t('projects.new')}
          </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('projects.empty')}</p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((p) => (
            <li key={p.id} className={cn('rounded-xl border border-border bg-card p-3', p.archived && 'opacity-60')}>
              <div className="flex items-start gap-2">
                <ColorDot color={p.color} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <Link href={`/time?period=all&project=${p.id}`} className="block truncate font-semibold hover:text-primary">
                    {p.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">{p.contactName ?? t('projects.noContact')}</div>
                </div>
                {canEdit && (
                <div className="flex shrink-0">
                  <button type="button" onClick={() => setEditing(p)} className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-primary" aria-label={t('projects.edit')}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => act(() => updateProject(p.id, { archived: !p.archived }), p.archived ? t('projects.restored') : t('projects.archived'))}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-primary"
                    aria-label={p.archived ? t('projects.restore') : t('projects.archive')}
                    title={p.archived ? t('projects.restore') : t('projects.archive')}
                  >
                    {p.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => window.confirm(t('projects.deleteConfirm')) && act(() => deleteProject(p.id), t('projects.deleted'))}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">{t('columns.rate')}</dt>
                  <dd className="font-semibold tabular-nums">{p.hourlyRate ? `${formatMoney(Number(p.hourlyRate), p.currency, locale)}/h` : '–'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('state.unbilled')}</dt>
                  <dd className="font-mono font-semibold tabular-nums text-warning">{formatMinutes(p.unbilledMinutes ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('projects.total')}</dt>
                  <dd className="font-mono font-semibold tabular-nums">{formatMinutes(p.totalMinutes ?? 0)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('projects.new') : t('projects.edit')}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className="rounded-full px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-accent">
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={pending || !form.name.trim()}
              onClick={() =>
                act(
                  () => (editing === 'new' || !editing ? createProject(payload()) : updateProject(editing.id, payload())),
                  t('saved'),
                  () => setEditing(null)
                )
              }
              className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {t('save')}
            </button>
          </>
        }
      >
        <div className="grid gap-3">
          <label className="block">
            <span className={label}>{t('projects.name')}</span>
            <input className={field} value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </label>
          <label className="block">
            <InfoHint hint={t('projects.contactHint')} className={label}>
              <span>{t('columns.contact')}</span>
            </InfoHint>
            <select className={field} value={form.contact_id ?? ''} onChange={(e) => setForm({ ...form, contact_id: e.target.value || null })}>
              <option value="">{t('projects.noContact')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 block">
              <span className={label}>{t('columns.rate')} (/h)</span>
              <input
                className={field}
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="0"
              />
            </label>
            <label className="block">
              <span className={label}>{t('projects.currency')}</span>
              <select className={field} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <span className={label}>{t('projects.color')}</span>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  aria-label={c}
                  aria-pressed={form.color === c}
                  className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-card', form.color === c && 'ring-2 ring-foreground')}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
