'use client';

import { useEffect, useState } from 'react';
import { Copy, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LinkNameField } from '@/components/link-name-field';
import { toast } from '@/components/toaster';
import { useCanWrite } from '@/components/access-provider';
import { copyText } from '@/lib/clipboard';
import { setInvoiceLinkName } from '../actions';

/** The client link of an issued document: copy it, and give it a readable name of its own. */
export function PublicLinkPanel({ id, link, defaultLink, slug }: { id: string; link: string; defaultLink: string; slug: string | null }) {
  const t = useTranslations('linkName');
  // Copying the link is for everyone; renaming it changes the document.
  const canEdit = useCanWrite('invoices');
  // Same form as the {link} in e-mails (no locale: the page picks it up).
  const [base, setBase] = useState('/i/');
  useEffect(() => setBase(`${window.location.origin}/i/`), []);
  const url = `${base}${link}`;

  const copy = async () => {
    try {
      await copyText(url);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    }
  };

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" />
        {t('title')}
      </h2>
      <div className="mt-3 flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('title')}
          className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 font-mono text-xs"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent hover:text-primary"
        >
          <Copy className="h-3.5 w-3.5" />
          {t('copy')}
        </button>
      </div>
      {canEdit && <LinkNameField className="mt-3" base={base} link={link} defaultLink={defaultLink} slug={slug} onSave={(s) => setInvoiceLinkName(id, s)} />}
    </section>
  );
}
