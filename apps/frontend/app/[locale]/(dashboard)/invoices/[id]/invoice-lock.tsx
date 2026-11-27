'use client';

import { useState, useTransition } from 'react';
import { Lock, LockOpen, UserRoundCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { PasswordInput } from '@/components/password-input';
import { toast } from '@/components/toaster';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { relockInvoices, setInvoiceLock, setInvoicePrivate, unlockInvoices } from '../actions';

const KNOWN = ['wrong_current', 'reauth_required', 'too_many_attempts'];

/** Shown instead of a locked invoice: the viewer's own password opens it for a while. */
export function UnlockInvoice() {
  const t = useTranslations('doc.lock');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await unlockInvoices(password);
      if (!res.ok) {
        setError(KNOWN.includes(res.error) ? t(`errors.${res.error}`) : t('errors.generic'));
        return;
      }
      setPassword('');
      router.refresh();
    });
  }

  return (
    <div className="mx-auto mt-10 max-w-sm rounded-xl border border-border bg-card p-6 text-center">
      <Lock className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      <form onSubmit={submit} className="mt-4 space-y-3 text-left">
        <PasswordInput
          className={inputClass}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder={t('password')}
          aria-label={t('password')}
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={pending} className={cn(buttonClass.primary, 'w-full')}>
          {t('open')}
        </button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">{t('note')}</p>
      <TeamHint />
    </div>
  );
}

/**
 * People read "hidden" as "hidden from colleagues", so say plainly that it
 * isn't and point to what is: the private switch below when the viewer may
 * use it, otherwise who sees which clients in the team settings.
 */
function TeamHint({ toPrivacy = false }: { toPrivacy?: boolean }) {
  const t = useTranslations('doc.lock');
  const cls = 'font-medium text-primary underline-offset-2 hover:underline';
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('teamHint')}{' '}
      {toPrivacy ? (
        <a href="#invoice-privacy" className={cls}>
          {t('privacyLink')}
        </a>
      ) : (
        <Link href="/settings/team" className={cls}>
          {t('teamLink')}
        </Link>
      )}
    </p>
  );
}

/**
 * "Soukromá faktura": only the company owner and whoever created it see it,
 * with its items, files and payments. Only those two get the switch; the
 * API refuses anyone else. Others see the badge.
 */
export function InvoicePrivacy({ id, isPrivate, canChange }: { id: string; isPrivate: boolean; canChange: boolean }) {
  const t = useTranslations('doc.privacy');
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canChange && !isPrivate) return null;

  function toggle(next: boolean) {
    start(async () => {
      const res = await setInvoicePrivate(id, next);
      if (!res.ok) {
        toast({ text: res.error.includes('visibility_owner_only') ? t('ownerOnly') : t('failed'), tone: 'err' });
        return;
      }
      toast({ text: next ? t('madePrivate') : t('madeShared'), tone: 'ok' });
      router.refresh();
    });
  }

  return (
    <div id="invoice-privacy" className="mb-3 scroll-mt-20 text-sm">
      {canChange ? (
        <label className="inline-flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={isPrivate} disabled={pending} onChange={(e) => toggle(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1 font-medium">
              <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('label')}
            </span>
            <span className="block text-xs text-muted-foreground">{t('hint')}</span>
          </span>
        </label>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
          <UserRoundCheck className="h-3.5 w-3.5" aria-hidden="true" />
          {t('badge')}
        </span>
      )}
    </div>
  );
}

/** Lock state on an open invoice; the toggle is for owners and admins. */
export function InvoiceLockBar({ id, locked, canLock, canPrivate = false }: { id: string; locked: boolean; canLock: boolean; canPrivate?: boolean }) {
  const t = useTranslations('doc.lock');
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!locked && !canLock) return null;

  function toggle() {
    start(async () => {
      const res = await setInvoiceLock(id, !locked);
      if (!res.ok) {
        toast({ text: t('errors.generic'), tone: 'err' });
        return;
      }
      toast({ text: locked ? t('unlockedToast') : t('lockedToast'), tone: 'ok' });
      router.refresh();
    });
  }

  function relock() {
    start(async () => {
      await relockInvoices();
      router.refresh();
    });
  }

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {locked && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {t('badge')}
          </span>
        )}
        {canLock && (
          <button type="button" onClick={toggle} disabled={pending} className={cn(buttonClass.secondary, 'h-8 px-3 text-xs')} title={locked ? undefined : t('lockHint')}>
            {locked ? <LockOpen className="mr-1.5 h-3.5 w-3.5" /> : <Lock className="mr-1.5 h-3.5 w-3.5" />}
            {locked ? t('unlock') : t('lock')}
          </button>
        )}
        {locked && (
          <button type="button" onClick={relock} disabled={pending} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            {t('relock')}
          </button>
        )}
      </div>
      {locked && <TeamHint toPrivacy={canPrivate} />}
    </div>
  );
}
