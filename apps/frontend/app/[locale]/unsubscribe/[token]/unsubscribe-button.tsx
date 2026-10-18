'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { buttonClass } from '@/components/modal';
import { Link } from '@/i18n/navigation';

export function UnsubscribeButton({ token, already }: { token: string; already: boolean }) {
  const t = useTranslations('unsubscribe');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>(already ? 'done' : 'idle');

  const confirm = async () => {
    setState('busy');
    try {
      // Same endpoint mail clients use for one-click unsubscribe.
      const res = await fetch(`/api/email/unsubscribe/${encodeURIComponent(token)}`, { method: 'POST' });
      setState(res.ok ? 'done' : 'failed');
    } catch {
      setState('failed');
    }
  };

  if (state === 'done') {
    return (
      <div className="mt-6">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="h-4 w-4 text-success" />
          {already ? t('already') : t('done')}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {t.rich('manage', { link: (chunks) => <Link href="/settings/email-notifications" className="text-primary hover:underline">{chunks}</Link> })}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {state === 'failed' && <Banner tone="err" title={t('errors.unavailable')} className="mb-4" />}
      <button type="button" className={buttonClass.primary} onClick={confirm} disabled={state === 'busy'}>
        {state === 'busy' && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('confirm')}
      </button>
    </div>
  );
}
