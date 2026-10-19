'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { claimPromo } from '@/app/[locale]/(dashboard)/billing/actions';
import { usePromoText } from '@/components/promo-text';

/**
 * Rendered by the dashboard shell when a `billanta_promo` cookie is present
 * and the member may manage billing: redeems the code once and says what it
 * brought, or why it didn't apply.
 */
export function PromoClaim() {
  const t = useTranslations('promo');
  const { benefit, error } = usePromoText();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    claimPromo()
      .then((result) => {
        if (!result) return;
        if (result.ok) toast({ text: t('appliedToast', { code: result.data.code, benefit: benefit(result.data) }), tone: 'ok' });
        else toast({ text: t('notAppliedToast', { reason: error(result.error) }), tone: 'err' });
      })
      .catch(() => {});
  }, [t, benefit, error]);

  return null;
}
