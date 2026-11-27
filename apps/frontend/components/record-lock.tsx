'use client';

import { useTransition } from 'react';
import { Lock, LockOpen, UserRoundCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useStepUp } from '@/components/step-up';
import { toast } from '@/components/toaster';
import { ACCESS_LOCK_LEVELS, type AccessLock } from '@/lib/record-lock';
import { setAccessLock, type LockKind } from '@/lib/record-lock-actions';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const ERRORS = new Set(['visibility_owner_only', 'visibility_would_hide', 'record_read_only']);

/**
 * The padlock in lists, with who still sees the row as its label. The
 * invoice list already uses a padlock for "Skrýt detaily", so it asks for
 * the person icon instead.
 */
export function LockBadge({ level, icon = 'lock', className }: { level: AccessLock | null | undefined; icon?: 'lock' | 'person'; className?: string }) {
  const t = useTranslations('recordLock.badge');
  if (!level) return null;
  const Icon = icon === 'person' ? UserRoundCheck : Lock;
  return (
    <span title={t(level)} className="inline-flex shrink-0">
      <Icon className={cn('h-3.5 w-3.5 text-muted-foreground', className)} aria-label={t(level)} role="img" />
    </span>
  );
}

/**
 * Who sees an invoice, expense or client beyond the area's usual readers.
 * Whoever sets a lock holds it: only they and the company owner may change
 * it later, so everyone else gets the read-out. Opening it up asks for a
 * step-up (the backend decides).
 */
export function RecordLock({
  kind,
  id,
  level,
  canChange,
  anchorId,
  bare = false
}: {
  kind: LockKind;
  id: string;
  level: AccessLock | null;
  canChange: boolean;
  anchorId?: string;
  /** Inside a card that already has its own heading. */
  bare?: boolean;
}) {
  const t = useTranslations('recordLock');
  const router = useRouter();
  const [pending, start] = useTransition();
  const { withStepUp, stepUpDialog } = useStepUp();
  if (!canChange && !level) return null;

  function save(next: AccessLock | null) {
    start(async () => {
      const res = await withStepUp(() => setAccessLock(kind, id, next));
      if (!res) return router.refresh();
      if (!res.ok) {
        const code = [...ERRORS].find((c) => res.error.includes(c));
        toast({ text: code ? t(`errors.${code}`) : `${t('failed')}: ${res.error}`, tone: 'err' });
        return;
      }
      toast({ text: next ? t('locked') : t('opened'), tone: 'ok' });
      router.refresh();
    });
  }

  if (!canChange) {
    return (
      <div id={anchorId} className={cn('scroll-mt-20 text-sm', !bare && 'mb-3')}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          {t(`badge.${level!}`)}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">{t('holderOnly')}</p>
      </div>
    );
  }

  return (
    <div id={anchorId} className={cn('scroll-mt-20 text-sm', !bare && 'mb-3 max-w-md')}>
      {stepUpDialog}
      <label className="block">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {level ? <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> : <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />}
          {t('label')}
        </span>
        <select
          className={cn(inputClass, 'mt-1 py-1.5')}
          value={level ?? ''}
          disabled={pending}
          onChange={(e) => save((e.target.value || null) as AccessLock | null)}
        >
          <option value="">{t(`levels.none.${kind}`)}</option>
          {ACCESS_LOCK_LEVELS.map((l) => (
            <option key={l} value={l}>
              {t(`levels.${l}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
