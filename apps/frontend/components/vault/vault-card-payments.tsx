'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { fetchCardPaymentsToSeal } from '@/lib/vault/actions';
import { sealCardPayments } from '@/lib/vault/card-payments';
import { useVault } from './vault-provider';

/**
 * "Důvěrný režim": card payments of documents with sealed amounts arrive in
 * plain (Stripe charges a number). Once a member who may edit invoices has
 * the vault unlocked, this seals them under their documents' keys in the
 * background, so the server forgets the amounts. Renders nothing.
 */
export function VaultCardPayments({ canEdit }: { canEdit: boolean }) {
  const t = useTranslations('vault.payments');
  const router = useRouter();
  const { vault, key } = useVault();
  const ranFor = useRef<unknown>(null);

  useEffect(() => {
    if (!vault || !key || !canEdit || ranFor.current === key) return;
    ranFor.current = key;
    void (async () => {
      const waiting = await fetchCardPaymentsToSeal();
      if (!waiting.ok || waiting.value.length === 0) return;
      const { sealed } = await sealCardPayments(key, waiting.value);
      if (!sealed) return;
      toast({ text: t('cardSealed', { n: sealed }), tone: 'ok' });
      router.refresh();
    })();
  }, [vault, key, canEdit, router, t]);

  return null;
}
