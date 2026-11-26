'use client';

import { useTransition } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { toast } from '@/components/toaster';
import { rematchTransactions } from './actions';

/** "Spárovat znovu": auto-match once more over every unmatched payment. */
export function RematchButton() {
  const t = useTranslations('bank.rematch');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await rematchTransactions();
      if (!result.ok) {
        toast({ text: t('failed', { code: result.error }), tone: 'err' });
        return;
      }
      const found = result.matched + result.linked;
      toast({
        text: found === 0 ? t('nothing', { checked: result.checked }) : t('done', { matched: result.matched, linked: result.linked }),
        tone: found === 0 ? 'info' : 'ok'
      });
      router.refresh();
    });

  return (
    <button type="button" className={buttonClass.secondary} disabled={pending} onClick={run}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
      {t('label')}
    </button>
  );
}
