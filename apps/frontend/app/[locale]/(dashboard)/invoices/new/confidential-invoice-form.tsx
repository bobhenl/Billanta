'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isSealed, open, type VaultKey } from '@faktur/cz-compliance';
import { useVault } from '@/components/vault/vault-provider';
import { draftIsSealed, openDraft } from '@/lib/vault/content';
import { contactIsSealed, openContact, openContacts } from '@/lib/vault/contacts';
import { buttonClass } from '@/lib/ui-classes';
import { InvoiceForm } from './invoice-form';
import type { InvoiceTemplate } from './types';

/** The customer of the starting point is encrypted (category "contacts"). */
const buyerIsSealed = (template: InvoiceTemplate | null) => contactIsSealed(template?.contact) || isSealed(template?.buyerContactPerson);

async function openTemplate(key: VaultKey, template: InvoiceTemplate): Promise<InvoiceTemplate> {
  const texts = draftIsSealed(template) ? await openDraft(key, template) : template;
  return {
    ...texts,
    contact: texts.contact ? await openContact(key, texts.contact) : texts.contact,
    buyerContactPerson: isSealed(texts.buyerContactPerson) ? await open(key, texts.buyerContactPerson!) : texts.buyerContactPerson
  };
}

/**
 * The invoice editor with "Důvěrný režim": an encrypted starting point
 * (edit, duplicate, template) is opened in the browser first, its texts and
 * its customer alike, and the form gets what it needs to encrypt on save.
 * Without the mode it is the plain form.
 */
export function ConfidentialInvoiceForm(props: ComponentProps<typeof InvoiceForm>) {
  const t = useTranslations('vault.editor');
  const { vault, key, requestUnlock } = useVault();
  const template = props.template ?? null;
  const textsSealed = draftIsSealed(template);
  const sealed = textsSealed || buyerIsSealed(template);
  const [opened, setOpened] = useState<InvoiceTemplate | null | 'failed'>(sealed ? null : template);
  // Starred customers only need opening for their names; locked, they show a lock.
  const [starred, setStarred] = useState(props.starred);

  useEffect(() => {
    if (!sealed) return setOpened(template);
    if (!key || !template) return setOpened(null);
    let live = true;
    openTemplate(key, template)
      .then((t) => live && setOpened(t))
      .catch(() => live && setOpened('failed'));
    return () => {
      live = false;
    };
  }, [sealed, key, template]);

  useEffect(() => {
    setStarred(props.starred);
    if (!key || !props.starred) return;
    let live = true;
    void openContacts(key, props.starred).then((list) => live && setStarred(list));
    return () => {
      live = false;
    };
  }, [key, props.starred]);

  // Below Plus an already encrypted document still opens and stays encrypted
  // on save; a plain one is edited as plain, like any gated feature.
  if (!vault || (vault.planAllowed === false && !sealed)) return <InvoiceForm {...props} starred={starred} />;

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

  // After a downgrade the server keeps an encrypted document sealed but refuses
  // new ciphertext, so a copy of one is saved as plain text.
  const mayKeepSealed = vault.planAllowed !== false || props.mode?.kind === 'edit';
  return (
    <InvoiceForm
      {...props}
      starred={starred}
      template={opened === 'failed' ? null : opened}
      confidential={{
        sealByDefault: (textsSealed && mayKeepSealed) || (vault.sealNew && vault.planAllowed !== false),
        getKey: requestUnlock,
        // An edit keeps the document's key, so a client link sent before still opens it; a copy gets its own.
        keySource: props.mode?.kind === 'edit' ? template : null,
        buyerSealed: buyerIsSealed(template) && mayKeepSealed
      }}
    />
  );
}
