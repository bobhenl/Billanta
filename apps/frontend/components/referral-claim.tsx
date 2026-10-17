'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { claimReferral } from '@/app/[locale]/(dashboard)/settings/referrals/actions';

/**
 * Rendered by the dashboard shell when a `billanta_ref` cookie is present
 * and the member owns the active company: claims the invite once and says
 * how many credits the welcome bonus brought.
 */
export function ReferralClaim() {
  const t = useTranslations('referrals');
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    claimReferral()
      .then(({ credits }) => {
        if (credits > 0) toast({ text: t('welcomeToast', { credits }), tone: 'ok' });
      })
      .catch(() => {});
  }, [t]);

  return null;
}
