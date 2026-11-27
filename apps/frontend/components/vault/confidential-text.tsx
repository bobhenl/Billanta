'use client';

import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isSealed, open } from '@faktur/cz-compliance';
import { cn } from '@/lib/utils';
import { useVault } from './vault-provider';

/**
 * A text that may be a "Důvěrný režim" envelope: plain text renders as is,
 * an envelope is opened in the browser once the key is unlocked. Until then
 * it shows a lock with an "Odemknout" button, never the ciphertext.
 * `compact` drops the button, for a cell or a link that is clickable itself.
 */
export function ConfidentialText({ value, className, compact = false }: { value: string | null | undefined; className?: string; compact?: boolean }) {
  const t = useTranslations('vault.text');
  const { key, requestUnlock } = useVault();
  const sealed = isSealed(value);
  const [plain, setPlain] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sealed || !key || !value) return setPlain(null);
    let live = true;
    open(key, value)
      .then((text) => live && (setPlain(text), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [sealed, key, value]);

  if (!value) return null;
  if (!sealed) return <span className={className}>{value}</span>;
  if (plain != null) return <span className={className}>{plain}</span>;
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1.5 text-muted-foreground', className)}>
      <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="italic">{failed ? t('otherKey') : t('locked')}</span>
      {!failed && !compact && (
        <button type="button" onClick={() => void requestUnlock()} className="text-xs font-semibold text-primary hover:underline">
          {t('unlock')}
        </button>
      )}
    </span>
  );
}
