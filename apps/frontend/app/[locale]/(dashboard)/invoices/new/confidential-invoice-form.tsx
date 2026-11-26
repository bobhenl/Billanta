'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useVault } from '@/components/vault/vault-provider';
import { draftIsSealed, openDraft } from '@/lib/vault/content';
import { buttonClass } from '@/lib/ui-classes';
import { InvoiceForm } from './invoice-form';
import type { InvoiceTemplate } from './types';

/**
 * The invoice editor with "Důvěrný režim": an encrypted starting point
 * (edit, duplicate, template) is opened in the browser first, and the form
 * gets what it needs to encrypt on save. Without the mode it is the plain form.
 */
export function ConfidentialInvoiceForm(props: ComponentProps<typeof InvoiceForm>) {
  const t = useTranslations('vault.editor');
  const { vault, key, requestUnlock } = useVault();
  const template = props.template ?? null;
  const sealed = draftIsSealed(template);
  const [opened, setOpened] = useState<InvoiceTemplate | null | 'failed'>(sealed ? null : template);

  useEffect(() => {
    if (!sealed) return setOpened(template);
    if (!key || !template) return setOpened(null);
    let live = true;
    openDraft(key, template)
      .then((t) => live && setOpened(t))
      .catch(() => live && setOpened('failed'));
    return () => {
      live = false;
    };
  }, [sealed, key, template]);

  // Below Plus an already encrypted document still opens and stays encrypted
  // on save; a plain one is edited as plain, like any gated feature.
  if (!vault || (vault.planAllowed === false && !sealed)) return <InvoiceForm {...props} />;

  if (sealed && (!key || opened === null || opened === 'failed')) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-card p-6 text-center">
        <LockKeyhole className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-bold">{t('lockedTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{opened === 'failed' ? t('otherKey') : t('lockedLead')}</p>
        {key && opened === null ? (
          <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          opened !== 'failed' && (
            <button type="button" onClick={() => void requestUnlock()} className={`${buttonClass.primary} mt-4`}>
              {t('unlock')}
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <InvoiceForm
      {...props}
      template={opened === 'failed' ? null : opened}
      confidential={{ sealByDefault: sealed || (vault.sealNew && vault.planAllowed !== false), getKey: requestUnlock }}
    />
  );
}
