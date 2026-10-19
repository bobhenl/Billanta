'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { PromoBenefit } from '@/lib/promo';

/** "30 days of Plus to try" / "3 months of Plus free", and promo_* error codes as text. */
export function usePromoText() {
  const t = useTranslations('promo');
  const tPlan = useTranslations('billing.planNames');
  const benefit = useCallback(
    (p: Pick<PromoBenefit, 'benefitType' | 'benefitPlan' | 'benefitValue'>) =>
      t(`benefit.${p.benefitType}`, { count: p.benefitValue, plan: tPlan(p.benefitPlan) }),
    [t, tPlan]
  );
  const error = useCallback((code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic')), [t]);
  return { benefit, error };
}
