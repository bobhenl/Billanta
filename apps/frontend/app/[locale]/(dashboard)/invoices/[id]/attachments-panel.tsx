'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Eye, Loader2, LockKeyhole, Mail, Paperclip, Trash2, Upload, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { useVault } from '@/components/vault/vault-provider';
import { decryptNames, encryptedUpload, encryptsFiles, fetchDecrypted, previewable, saveLocally } from '@/lib/vault/files';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  /** Důvěrný režim: the sealed key, name and type; the stored file is then ciphertext. */
  encMeta?: string | null;
  /** Invoice attachments only. */
  sendWithEmail?: boolean;
  showInPortal?: boolean;
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
 * Files attached to an invoice (sent with the invoice email and/or offered
 * in the client portal, each switchable per file) or to an expense (the
 * receipt). In "Důvěrný režim" with the attachments category on, files are
 * encrypted here before upload and opened here after download.
 * A read-only member can download them and see both switches, nothing more.
 */
export function AttachmentsPanel({
  invoiceId,
  expenseId,
  initial,
  portal = false
}: {
  invoiceId?: string;
  expenseId?: string;
  initial: Attachment[];
  portal?: boolean;
}) {
  const t = useTranslations('doc.attachments');
  const locale = useLocale();
  const { vault, key, requestUnlock } = useVault();
  const [rows, setRows] = useState(initial);
  const [names, setNames] = useState<Record<string, { name: string; mime: string }>>({});
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; file: File } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const isInvoice = Boolean(invoiceId);
  const canEdit = useCanWrite(isInvoice ? 'invoices' : 'expenses');
  const base = isInvoice ? `/api/invoices/${invoiceId}/attachments` : `/api/expenses/${expenseId}/attachments`;
  const files = isInvoice ? `/api/files/invoices/${invoiceId}/attachments` : `/api/files/expenses/${expenseId}/attachments`;
  const encrypts = encryptsFiles(vault);

  useEffect(() => {
    if (!key || !rows.some((r) => r.encMeta && !names[r.id])) return;
    let live = true;
    void decryptNames(key, rows).then((found) => live && setNames((prev) => ({ ...prev, ...found })));
    return () => {
      live = false;
    };
  }, [key, rows, names]);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const fail = (code?: string) =>
    toast({ text: t(`errors.${['bad_type', 'too_big', 'too_many', 'plan_required', 'vault_category_off'].includes(code ?? '') ? code : 'generic'}`), tone: 'err' });

  async function upload(list: FileList | File[]) {
    const chosen = Array.from(list);
    if (!chosen.length) return;
    // Ask for the key once, before anything leaves the browser; closing the dialog uploads nothing.
    const fileKey = encrypts ? await requestUnlock() : null;
    if (encrypts && !fileKey) {
      if (input.current) input.current.value = '';
      return;
    }
    setBusy(true);
    try {
      for (const file of chosen) {
        if (file.size > MAX_BYTES) {
          fail('too_big');
          continue;
        }
        let body: FormData;
        if (fileKey) {
          body = await encryptedUpload(fileKey, file, file.name);
        } else {
          body = new FormData();
          body.set('file', file);
        }
        const res = await fetch(base, { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        const code = json?.error ?? json?.message?.error ?? (typeof json?.message === 'string' ? json.message : undefined);
        if (!res.ok) {
          fail(code);
          if (code === 'too_many') break;
          continue;
        }
        const row = json as Attachment;
        if (row.encMeta) setNames((prev) => ({ ...prev, [row.id]: { name: file.name, mime: file.type } }));
        setRows((prev) => [...prev, row]);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  /** Encrypted rows only: download, decrypt here, then show or save. */
  async function openEncrypted(row: Attachment, mode: 'preview' | 'save') {
    const k = key ?? (await requestUnlock());
    if (!k || !row.encMeta) return;
    setOpening(row.id);
    try {
      const file = await fetchDecrypted(`${files}/${row.id}`, k, row.encMeta);
      if (mode === 'preview' && previewable(file.type)) setPreview({ url: URL.createObjectURL(file), file });
      else saveLocally(file);
    } catch {
      toast({ text: t('decryptFailed'), tone: 'err' });
    } finally {
      setOpening(null);
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

  const label = (row: Attachment) => (row.encMeta ? (names[row.id]?.name ?? t('encryptedName')) : row.filename);

  async function remove(row: Attachment) {
    if (!window.confirm(t('confirmDelete', { name: label(row) }))) return;
    const res = await fetch(`${base}/${row.id}`, { method: 'DELETE' });
    if (res.ok) setRows((prev) => prev.filter((r) => r.id !== row.id));
    else fail();
  }

  if (!canEdit && rows.length === 0) return null;

  const toggleClass = (on: boolean) =>
    cn(
      'inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors',
      on ? 'bg-primary/15 text-primary' : 'text-muted-foreground/50 enabled:hover:bg-accent enabled:hover:text-muted-foreground'
    );

  return (
    <section
      className={cn('rounded-xl border bg-card p-4', dragging ? 'border-primary border-dashed' : 'border-border')}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (canEdit && rows.length < MAX) void upload(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <InfoHint hint={isInvoice ? t('hint') : t('hintExpense')}>
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Paperclip className="h-4 w-4 text-primary" />
            {t('title')}
            {rows.length > 0 && <span className="text-xs font-semibold text-muted-foreground">{rows.length}</span>}
          </h2>
        </InfoHint>
        {canEdit && rows.length < MAX && (
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
      {encrypts && canEdit && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <LockKeyhole className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t('encryptsNew')}
        </p>
      )}

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
              {row.encMeta ? (
                <button
                  type="button"
                  onClick={() => openEncrypted(row, 'preview')}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-primary"
                  title={t('openEncrypted')}
                >
                  {opening === row.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-primary" aria-label={t('encrypted')} />
                  )}
                  <span className={cn('truncate', !names[row.id] && 'italic text-muted-foreground')}>{label(row)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatSize(row.sizeBytes, locale)}</span>
                </button>
              ) : (
                <a href={`${files}/${row.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-primary" title={t('download')}>
                  <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{row.filename}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatSize(row.sizeBytes, locale)}</span>
                </a>
              )}
              {row.encMeta && (
                <button
                  type="button"
                  onClick={() => openEncrypted(row, 'save')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
                  title={t('download')}
                  aria-label={`${t('download')}: ${label(row)}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              )}
              {isInvoice && (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(row, 'sendWithEmail')}
                    disabled={!canEdit}
                    className={toggleClass(Boolean(row.sendWithEmail))}
                    title={row.sendWithEmail ? (row.encMeta ? t('emailOnEncrypted') : t('emailOn')) : t('emailOff')}
                    aria-label={row.sendWithEmail ? t('emailOn') : t('emailOff')}
                    aria-pressed={Boolean(row.sendWithEmail)}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(row, 'showInPortal')}
                    disabled={!canEdit || Boolean(row.encMeta)}
                    className={toggleClass(Boolean(row.showInPortal))}
                    title={row.encMeta ? t('portalEncrypted') : row.showInPortal ? t('portalOn') : t('portalOff')}
                    aria-label={row.encMeta ? t('portalEncrypted') : row.showInPortal ? t('portalOn') : t('portalOff')}
                    aria-pressed={Boolean(row.showInPortal)}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(row)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title={t('delete')}
                  aria-label={`${t('delete')}: ${label(row)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && isInvoice && !portal && rows.some((r) => r.showInPortal) && <p className="mt-2 text-xs text-muted-foreground">{t('portalNotYet')}</p>}

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        className="w-[min(56rem,calc(100vw-2rem))]"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Eye className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate">{preview?.file.name}</span>
          </span>
        }
        footer={
          preview && (
            <button type="button" onClick={() => saveLocally(preview.file)} className={buttonClass.secondary}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('download')}
            </button>
          )
        }
      >
        {preview &&
          (preview.file.type === 'application/pdf' ? (
            <iframe src={preview.url} title={preview.file.name} className="h-[70vh] w-full rounded-lg border border-border" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, nothing for next/image to optimise
            <img src={preview.url} alt={preview.file.name} className="mx-auto max-h-[70vh] max-w-full rounded-lg" />
          ))}
        <p className="mt-2 text-xs text-muted-foreground">{t('previewLocal')}</p>
      </Modal>
    </section>
  );
}
