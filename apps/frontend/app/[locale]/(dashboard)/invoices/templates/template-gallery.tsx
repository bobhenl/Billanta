'use client';

import { useState, useTransition } from 'react';
import { Clock, FileText, Home, LayoutTemplate, MoreHorizontal, Package, Pencil, Plus, Repeat, Trash2, Users, Wallet, type LucideIcon } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Modal, buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import type { DocumentType } from '../new/types';
import { deleteTemplate, renameTemplate } from './actions';
import type { TemplatePreset } from './presets';

/** `GET /api/v1/invoice-templates` row (camelCase, + contactName). */
export interface SavedTemplateRow {
  id: string;
  name: string;
  description: string | null;
  documentType: DocumentType;
  currency: string;
  dueInDays: number | null;
  contactName: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  lineItems: { description: string; quantity: number | string; unitPrice: number | string; vatRate: number | string | null; discountPercent?: number | string | null }[];
}

const PRESET_ICONS: Record<TemplatePreset['icon'], LucideIcon> = {
  clock: Clock,
  repeat: Repeat,
  package: Package,
  wallet: Wallet,
  file: FileText,
  home: Home
};

const TYPE_TONE: Record<DocumentType, string> = {
  invoice: 'bg-primary/10 text-primary',
  proforma: 'bg-warning/15 text-warning',
  quote: 'bg-success/15 text-success',
  credit_note: 'bg-destructive/10 text-destructive'
};

/** Net total of a template's items (one invoice from it, before VAT). */
function templateNet(items: SavedTemplateRow['lineItems']) {
  return items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice) * (1 - Number(i.discountPercent ?? 0) / 100), 0);
}

export function TemplateGallery({ saved, presets }: { saved: SavedTemplateRow[]; presets: TemplatePreset[] }) {
  const t = useTranslations('templates');
  const tDoc = useTranslations('doc');
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedTemplateRow | null>(null);
  const [deleting, setDeleting] = useState<SavedTemplateRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, start] = useTransition();

  const openEdit = (row: SavedTemplateRow) => {
    setMenu(null);
    setName(row.name);
    setDescription(row.description ?? '');
    setEditing(row);
  };

  const saveEdit = () => {
    if (!editing) return;
    start(async () => {
      const result = await renameTemplate(editing.id, name.trim(), description.trim());
      toast(result.ok ? { text: t('renamed'), tone: 'ok' } : { text: t('failed', { reason: result.error }), tone: 'err' });
      if (result.ok) {
        setEditing(null);
        router.refresh();
      }
    });
  };

  const confirmDelete = () => {
    if (!deleting) return;
    start(async () => {
      const result = await deleteTemplate(deleting.id);
      toast(result.ok ? { text: t('deleted'), tone: 'ok' } : { text: t('failed', { reason: result.error }), tone: 'err' });
      if (result.ok) {
        setDeleting(null);
        router.refresh();
      }
    });
  };

  const card = 'group relative flex flex-col rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md';
  const menuItem = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-secondary';

  return (
    <>
      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('saved', { count: saved.length })}</h2>
        {saved.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border p-8 text-center">
            <LayoutTemplate className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-semibold">{t('emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t('emptyHint')}</p>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {saved.map((row) => {
              const money = new Intl.NumberFormat(locale, { style: 'currency', currency: row.currency || 'CZK' });
              return (
                <div key={row.id} className={card}>
                  {/* The whole card opens the form; the menu button sits above this link. */}
                  <Link href={`/invoices/new?template=${row.id}`} className="absolute inset-0 rounded-xl" aria-label={t('useNamed', { name: row.name })} />
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <LayoutTemplate className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.contactName ?? t('anyCustomer')}</p>
                    </div>
                    <div className="relative z-10">
                      <button
                        type="button"
                        aria-label={t('menu')}
                        aria-expanded={menu === row.id}
                        onClick={() => setMenu(menu === row.id ? null : row.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menu === row.id && (
                        <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-border bg-popover p-1 text-sm shadow-lg" onMouseLeave={() => setMenu(null)}>
                          <Link href={`/invoices/new?template=${row.id}`} className={menuItem}>
                            <Plus className="h-4 w-4" /> {t('use')}
                          </Link>
                          <Link href={`/invoices/bulk?template=${row.id}`} className={menuItem}>
                            <Users className="h-4 w-4" /> {t('bulk')}
                          </Link>
                          <button type="button" onClick={() => openEdit(row)} className={menuItem}>
                            <Pencil className="h-4 w-4" /> {t('rename')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenu(null);
                              setDeleting(row);
                            }}
                            className={cn(menuItem, 'text-destructive hover:bg-destructive/10')}
                          >
                            <Trash2 className="h-4 w-4" /> {t('delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {row.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{row.description}</p>}
                  <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
                    {row.lineItems.slice(0, 3).map((item, i) => (
                      <li key={i} className="truncate">
                        · {item.description}
                      </li>
                    ))}
                    {row.lineItems.length > 3 && <li>{t('moreItems', { count: row.lineItems.length - 3 })}</li>}
                  </ul>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-4">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', TYPE_TONE[row.documentType])}>{tDoc(`type.${row.documentType}`)}</span>
                    <span className="text-right">
                      <span className="block font-extrabold tabular-nums">{money.format(templateNet(row.lineItems))}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {row.usageCount > 0 && row.lastUsedAt
                          ? t('usage', { count: row.usageCount, when: format.relativeTime(new Date(row.lastUsedAt)) })
                          : t('neverUsed')}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('starters')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('startersHint')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const Icon = PRESET_ICONS[preset.icon];
            return (
              <Link key={preset.key} href={`/invoices/new?preset=${preset.key}`} className={card}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{t(`presets.${preset.key}.name`)}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{t(`presets.${preset.key}.description`)}</p>
                  </div>
                </div>
                <div className="mt-auto pt-4">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', TYPE_TONE[preset.documentType])}>{tDoc(`type.${preset.documentType}`)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={t('rename')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setEditing(null)}>
              {t('cancel')}
            </button>
            <button type="button" className={buttonClass.primary} disabled={busy || !name.trim()} onClick={saveEdit}>
              {t('save')}
            </button>
          </>
        }
      >
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t('name')}</span>
          <input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">{t('description')}</span>
          <textarea className={inputClass} rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={t('deleteTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDeleting(null)}>
              {t('cancel')}
            </button>
            <button type="button" className={buttonClass.danger} disabled={busy} onClick={confirmDelete}>
              {t('delete')}
            </button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t('deleteBody', { name: deleting?.name ?? '' })}</p>
      </Modal>
    </>
  );
}
