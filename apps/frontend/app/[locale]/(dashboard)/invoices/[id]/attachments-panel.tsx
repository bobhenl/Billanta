'use client';

import { useRef, useState } from 'react';
import { Download, Loader2, Mail, Paperclip, Trash2, Upload, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sendWithEmail: boolean;
  showInPortal: boolean;
  createdAt: string;
}

const MAX = 10;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml,.doc,.docx,.xls,.xlsx';

function formatSize(bytes: number, locale: string) {
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 1 });
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${fmt(bytes / 1024)} kB` : `${fmt(bytes / 1024 / 1024)} MB`;
}

/**
 * Files attached to the invoice: sent along with the invoice email and/or
 * offered for download in the client portal (each switchable per file).
 */
export function AttachmentsPanel({ invoiceId, initial, portal }: { invoiceId: string; initial: Attachment[]; portal: boolean }) {
  const t = useTranslations('doc.attachments');
  const locale = useLocale();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const base = `/api/invoices/${invoiceId}/attachments`;

  const fail = (code?: string) => toast({ text: t(`errors.${['bad_type', 'too_big', 'too_many'].includes(code ?? '') ? code : 'generic'}`), tone: 'err' });

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        if (file.size > MAX_BYTES) {
          fail('too_big');
          continue;
        }
        const body = new FormData();
        body.set('file', file);
        const res = await fetch(base, { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          fail(json?.error ?? json?.message?.error);
          if (json?.error === 'too_many' || json?.message?.error === 'too_many') break;
          continue;
        }
        setRows((prev) => [...prev, json as Attachment]);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function toggle(row: Attachment, field: 'sendWithEmail' | 'showInPortal') {
    const next = !row[field];
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: next } : r)));
    const res = await fetch(`${base}/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(field === 'sendWithEmail' ? { send_with_email: next } : { show_in_portal: next })
    });
    if (!res.ok) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: !next } : r)));
      fail();
    }
  }

  async function remove(row: Attachment) {
    if (!window.confirm(t('confirmDelete', { name: row.filename }))) return;
    const res = await fetch(`${base}/${row.id}`, { method: 'DELETE' });
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== row.id));
    else fail();
  }

  const toggleClass = (on: boolean) =>
    cn(
      'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
      on ? 'bg-primary/15 text-primary' : 'text-muted-foreground/50 hover:bg-accent hover:text-muted-foreground'
    );

  return (
    <section
      className={cn('rounded-xl border bg-card p-4', dragging ? 'border-primary border-dashed' : 'border-border')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (rows.length < MAX) void upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <InfoHint hint={t('hint')}>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Paperclip className="h-4 w-4 text-primary" />
            {t('title')}
            {rows.length > 0 && <span className="text-xs font-semibold text-muted-foreground">{rows.length}</span>}
          </h2>
        </InfoHint>
        {rows.length < MAX && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-primary hover:bg-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {t('add')}
          </button>
        )}
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      {rows.length === 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          {t('empty')}
        </button>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="group flex items-center gap-1.5 text-sm">
              <a
                href={`/api/files/invoices/${invoiceId}/attachments/${row.id}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-primary"
                title={t('download')}
              >
                <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{row.filename}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSize(row.sizeBytes, locale)}</span>
              </a>
              <button
                type="button"
                onClick={() => toggle(row, 'sendWithEmail')}
                className={toggleClass(row.sendWithEmail)}
                title={row.sendWithEmail ? t('emailOn') : t('emailOff')}
                aria-pressed={row.sendWithEmail}
              >
                <Mail className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => toggle(row, 'showInPortal')}
                className={toggleClass(row.showInPortal)}
                title={row.showInPortal ? t('portalOn') : t('portalOff')}
                aria-pressed={row.showInPortal}
              >
                <Users className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => remove(row)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title={t('delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && !portal && rows.some((r) => r.showInPortal) && <p className="mt-2 text-xs text-muted-foreground">{t('portalNotYet')}</p>}
    </section>
  );
}
