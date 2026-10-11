'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { toast } from '@/components/toaster';
import { Link, useRouter } from '@/i18n/navigation';
import { completePsd2Connection } from '../actions';

const KNOWN = ['psd2_state_invalid', 'psd2_auth_failed', 'psd2_no_accounts', 'psd2_not_configured', 'psd2_rejected', 'bank_unavailable', 'forbidden'];

export function Psd2Callback({ code, state, error }: { code: string | null; state: string | null; error: string | null }) {
  const t = useTranslations('bank.connections');
  const router = useRouter();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(error ? t('psd2.cancelled') : !code || !state ? t('errors.psd2_state_invalid') : null);

  useEffect(() => {
    if (started.current || failure || !code || !state) return;
    started.current = true;
    completePsd2Connection(code, state).then((result) => {
      if (result.ok) {
        toast({ text: t('psd2.connected'), tone: 'ok' });
        router.replace('/bank');
      } else {
        setFailure(KNOWN.includes(result.error) ? t(`errors.${result.error}`) : t('errors.generic', { code: result.error }));
      }
    });
  }, [code, state, failure, router, t]);

  if (failure) {
    return (
      <div className="mx-auto mt-10 max-w-lg">
        <Banner tone="err" title={t('psd2.failedTitle')}>
          {failure}
        </Banner>
        <Link href="/bank" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
          {t('psd2.back')}
        </Link>
      </div>
    );
  }
  return (
    <div className="mx-auto mt-16 flex max-w-lg items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {t('psd2.finishing')}
    </div>
  );
}
