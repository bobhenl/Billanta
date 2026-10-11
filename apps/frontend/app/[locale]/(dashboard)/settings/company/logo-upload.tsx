'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';

const MAX_BYTES = 512 * 1024;
const TYPES = ['image/png', 'image/jpeg'];

/** Company logo printed in the top-right corner of every document (PNG/JPEG ≤ 512 kB). */
export function LogoUpload({ hasLogo, readOnly }: { hasLogo: boolean; readOnly: boolean }) {
  const t = useTranslations('settings.company.logo');
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [present, setPresent] = useState(hasLogo);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!TYPES.includes(file.type)) return toast({ text: t('badType'), tone: 'err' });
    if (file.size > MAX_BYTES) return toast({ text: t('tooBig'), tone: 'err' });
    setBusy(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const res = await fetch('/api/tenant/logo', { method: 'POST', body });
      if (!res.ok) {
        toast({ text: res.status === 400 ? t('badType') : t('failed', { status: res.status }), tone: 'err' });
        return;
      }
      setPresent(true);
      setVersion((v) => v + 1);
      toast({ text: t('saved'), tone: 'ok' });
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch('/api/tenant/logo', { method: 'DELETE' });
      if (!res.ok) return toast({ text: t('failed', { status: res.status }), tone: 'err' });
      setPresent(false);
      toast({ text: t('removed'), tone: 'ok' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-4">
      <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background">
        {present ? (
          // eslint-disable-next-line @next/next/no-img-element -- same-origin proxied image, no optimisation needed
          <img src={`/api/files/tenants/me/logo?v=${version}`} alt={t('alt')} className="max-h-14 max-w-[9.5rem] object-contain" />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t('title')}</div>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        {!readOnly && (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {present ? t('replace') : t('upload')}
            </button>
            {present && (
              <button type="button" className={buttonClass.ghost} disabled={busy} onClick={remove}>
                <Trash2 className="h-4 w-4" />
                {t('remove')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
