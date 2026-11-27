'use client';

import { useTransition } from 'react';
import { UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { RecordLock } from '@/components/record-lock';
import { useStepUp } from '@/components/step-up';
import { toast } from '@/components/toaster';
import type { AccessLock } from '@/lib/record-lock';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { setContactVisibility } from '../actions';

export interface TeamMemberOption {
  userId: string;
  name: string;
}

const ERRORS = new Set(['visibility_owner_only', 'visibility_would_hide', 'owner_not_member']);

/**
 * "Patří" and the access lock: who the client belongs to, and who else
 * still sees it and its documents. The API decides who may change which
 * (a locked client is handed over only by the company owner), so the rest
 * get a read-out.
 */
export function ContactVisibilityCard({
  contactId,
  ownerUserId,
  accessLock,
  members,
  canChangeOwner,
  canChangeLock
}: {
  contactId: string;
  ownerUserId: string | null;
  accessLock: AccessLock | null;
  members: TeamMemberOption[];
  canChangeOwner: boolean;
  canChangeLock: boolean;
}) {
  const t = useTranslations('contacts.detail.visibility');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { withStepUp, stepUpDialog } = useStepUp();
  const ownerName = members.find((m) => m.userId === ownerUserId)?.name ?? null;

  // Nothing to say to someone who can't change it and the client is the company's.
  if (!canChangeOwner && !canChangeLock && !ownerUserId && !accessLock) return null;

  const saveOwner = (next: string | null) =>
    startTransition(async () => {
      const result = await withStepUp(() => setContactVisibility(contactId, { ownerUserId: next }));
      if (!result) return router.refresh();
      if (result.ok) toast({ text: t('saved'), tone: 'ok' });
      else toast({ text: ERRORS.has(result.error) ? t(`errors.${result.error}`) : `${t('failed')}: ${result.error}`, tone: 'err' });
      router.refresh();
    });

  return (
    <section id="contact-visibility" className="scroll-mt-20 rounded-xl border border-border bg-card p-4 text-sm">
      {stepUpDialog}
      <InfoHint hint={t('hint')}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('title')}</h2>
      </InfoHint>
      <div className="mt-3 space-y-3">
        {canChangeOwner ? (
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{t('owner')}</span>
            <select
              className={cn(inputClass, 'mt-1 py-1.5')}
              value={ownerUserId ?? ''}
              disabled={pending}
              onChange={(e) => saveOwner(e.target.value || null)}
            >
              <option value="">{t('nobody')}</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
              {/* A former member stays visible as the owner until someone picks another. */}
              {ownerUserId && !ownerName && <option value={ownerUserId}>{t('formerMember')}</option>}
            </select>
          </label>
        ) : (
          ownerUserId && (
            <div className="flex gap-2">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{t('ownedBy', { name: ownerName ?? t('formerMember') })}</span>
            </div>
          )
        )}
        <RecordLock kind="contact" id={contactId} level={accessLock} canChange={canChangeLock} bare />
        {!canChangeOwner && !canChangeLock && <p className="text-xs text-muted-foreground">{t('ownerOnly')}</p>}
      </div>
    </section>
  );
}
