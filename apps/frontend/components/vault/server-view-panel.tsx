'use client';

import { ChevronDown, Eye } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { isSealed } from '@faktur/cz-compliance';
import { ConfidentialText } from './confidential-text';

const MAX_FIELDS = 20;

/**
 * "Co vidí server": each encrypted text of a document as it is stored (the
 * envelope the server has) next to what this browser shows after
 * unlocking. The envelope is exactly what the page received from the
 * server, so anyone can compare it with the response in DevTools.
 */
export function ServerViewPanel({ fields }: { fields: { label: string; value: string | null | undefined }[] }) {
  const t = useTranslations('vault.serverView');
  const locale = useLocale();
  const sealed = fields.filter((f): f is { label: string; value: string } => isSealed(f.value)).slice(0, MAX_FIELDS);
  if (sealed.length === 0) return null;

  return (
    <details className="group rounded-xl border border-border bg-card p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold [&::-webkit-details-marker]:hidden">
        <Eye className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('title')}
        <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{t('lead')}</p>
      <ul className="mt-3 space-y-3">
        {sealed.map((f, i) => (
          <li key={i} className="space-y-1 text-xs">
            <p className="font-semibold">{f.label}</p>
            <p className="text-muted-foreground">{t('server')}</p>
            <code className="block break-all rounded-lg bg-muted/60 p-2 font-mono text-[11px]">{f.value}</code>
            <p className="text-muted-foreground">{t('you')}</p>
            <p className="whitespace-pre-line rounded-lg border border-border p-2 text-sm">
              <ConfidentialText value={f.value} />
            </p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">{t('notSealed')}</p>
      <a href={`/${locale}/security/confidential`} className="mt-2 inline-block text-xs font-semibold underline underline-offset-2">
        {t('more')}
      </a>
    </details>
  );
}
