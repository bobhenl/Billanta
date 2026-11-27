'use client';

import { useTransition } from 'react';
import { Lock, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { InfoHint } from '@/components/info-hint';
import { useStepUp } from '@/components/step-up';
import { toast } from '@/components/toaster';
import { inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { setContactVisibility } from '../actions';

export interface TeamMemberOption {
  userId: string;
  name: string;
}

const ERRORS = new Set(['visibility_owner_only', 'visibility_would_hide', 'owner_not_member']);

/**
 * "Patří" and "Soukromý": who the client belongs to and whether only they
 * and the company owner see it. Only those two may change it; the API
 * refuses anyone else, so for the rest this is just a read-out.
 */
export function ContactVisibilityCard({
  contactId,
  ownerUserId,
  isPrivate,
  members,
  canChange
}: {
  contactId: string;
  ownerUserId: string | null;
  isPrivate: boolean;
  members: TeamMemberOption[];
  canChange: boolean;
}) {
  const t = useTranslations('contacts.detail.visibility');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { withStepUp, stepUpDialog } = useStepUp();
  const ownerName = members.find((m) => m.userId === ownerUserId)?.name ?? null;

  // Nothing to say to someone who can't change it and the client is the company's.
  if (!canChange && !ownerUserId && !isPrivate) return null;

  const save = (change: { ownerUserId?: string | null; isPrivate?: boolean }) =>
    startTransition(async () => {
      const result = await withStepUp(() => setContactVisibility(contactId, change));
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
      {canChange ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{t('owner')}</span>
            <select
              className={cn(inputClass, 'mt-1 py-1.5')}
              value={ownerUserId ?? ''}
              disabled={pending}
              onChange={(e) => save({ ownerUserId: e.target.value || null })}
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
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 accent-primary" checked={isPrivate} disabled={pending} onChange={(e) => save({ isPrivate: e.target.checked })} />
            <span>
              <span className="flex items-center gap-1 font-medium">
                <Lock className="h-3.5 w-3.5" />
                {t('private')}
              </span>
              <span className="block text-xs text-muted-foreground">{t('privateHint')}</span>
            </span>
          </label>
        </div>
      ) : (
        <dl className="mt-3 space-y-2">
          {ownerUserId && (
            <div className="flex gap-2">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{t('ownedBy', { name: ownerName ?? t('formerMember') })}</dd>
            </div>
          )}
          {isPrivate && (
            <div className="flex gap-2">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{t('private')}</dd>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('ownerOnly')}</p>
        </dl>
      )}
    </section>
  );
}
