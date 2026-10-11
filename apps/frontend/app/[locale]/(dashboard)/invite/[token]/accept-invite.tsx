'use client';

import { useTransition } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { acceptInvitation } from './actions';

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('invite');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={`${buttonClass.primary} w-full`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await acceptInvitation(token);
          if (result.ok) {
            toast({ text: t('accepted'), tone: 'ok' });
            router.push('/dashboard');
          } else {
            toast({ text: `${t('failed')}: ${result.error}`, tone: 'err' });
          }
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      {t('accept')}
    </button>
  );
}
