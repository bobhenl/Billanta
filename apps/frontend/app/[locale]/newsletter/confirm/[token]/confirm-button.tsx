'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';

type ConfirmError = 'invalid_confirm_link' | 'confirm_link_expired' | 'rate_limited' | 'unavailable';

export function ConfirmButton({ token, already }: { token: string; already: boolean }) {
  const t = useTranslations('newsletter.confirm');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>(already ? 'done' : 'idle');
  const [error, setError] = useState<ConfirmError | null>(null);

  const confirm = async () => {
    setState('busy');
    setError(null);
    try {
      const res = await fetch(`/api/public/newsletter/confirm/${encodeURIComponent(token)}`, { method: 'POST' });
      if (res.ok) return setState('done');
      const body = (await res.json().catch(() => null)) as { error?: ConfirmError } | null;
      setError(body?.error ?? 'unavailable');
    } catch {
      setError('unavailable');
    }
    setState('idle');
  };

  if (state === 'done') {
    return (
      <div className="mt-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-success" />
          {t('doneTitle')}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">{t('doneBody')}</p>
        <Link href="/" className={`${buttonClass.secondary} mt-5`}>
          {t('backHome')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {error && <Banner tone="err" title={t(`errors.${error}`)} className="mb-4" />}
      <button type="button" className={buttonClass.primary} onClick={confirm} disabled={state === 'busy'}>
        {state === 'busy' && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('button')}
      </button>
    </div>
  );
}
