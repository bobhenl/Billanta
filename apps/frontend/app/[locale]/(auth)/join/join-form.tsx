'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { copyText } from '@/lib/clipboard';
import type { JoinPreview } from '@/lib/classroom';

type Entered = { redirect: string; nickname: string | null; reentryCode: string | null };

/**
 * Joining a class, or coming back to one's company with the personal code.
 * After joining the personal code is shown once, before the dashboard, so
 * the student can write it down.
 */
export function JoinForm({ code, preview, disabled }: { code: string; preview: JoinPreview; disabled: boolean }) {
  const t = useTranslations('classroomJoin');
  const tKinds = useTranslations('demo.kinds');
  const canJoin = preview.enrolmentOpen && !preview.ended;
  const [mode, setMode] = useState<'join' | 'reenter'>(canJoin ? 'join' : 'reenter');
  const [nickname, setNickname] = useState('');
  const [kind, setKind] = useState(preview.companyKinds[0] ?? '');
  const [personalCode, setPersonalCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Entered | null>(null);

  async function send(path: 'join' | 'reenter', body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/classroom/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, ...body })
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as (Entered & { error?: string }) | null;
    if (!res?.ok || !data?.redirect) {
      const code = data?.error && t.has(`errors.${data.error}`) ? data.error : 'classroom_unavailable';
      setError(t(`errors.${code}`));
      setBusy(false);
      return;
    }
    // A full load, so every server component sees the new session cookie.
    if (path === 'join' && data.reentryCode) setJoined(data);
    else window.location.assign(data.redirect);
  }

  if (joined) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-extrabold tracking-tight">{t('done.title', { nickname: joined.nickname ?? nickname })}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('done.body')}</p>
        <p className="mt-4 select-all rounded-lg bg-secondary px-3 py-3 text-center font-mono text-2xl font-extrabold tracking-widest">{joined.reentryCode}</p>
        <button
          type="button"
          onClick={() => void copyText(joined.reentryCode ?? '').then(() => toast({ text: t('done.copied'), tone: 'ok' }), () => undefined)}
          className={`${buttonClass.ghost} mt-2 w-full`}
        >
          {t('done.copy')}
        </button>
        <button type="button" onClick={() => window.location.assign(joined.redirect)} className={`${buttonClass.primary} mt-3 w-full`}>
          {t('done.continue')}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">{preview.schoolName}</p>
      <h1 className="mt-1 text-xl font-extrabold tracking-tight">{t('heading', { className: preview.className })}</h1>
      {!canJoin && (
        <Banner tone="info" title={preview.ended ? t('ended') : t('closed')} className="mt-4" />
      )}

      {mode === 'join' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send('join', { nickname: nickname.trim(), kind });
          }}
          className="mt-4 space-y-4"
        >
          <label className="block text-sm font-medium">
            {t('nickname')}
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
              minLength={2}
              maxLength={30}
              autoComplete="off"
              className={`${inputClass} mt-1`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('nicknameHint')}</span>
          </label>
          {preview.companyKinds.length > 1 && (
            <fieldset>
              <legend className="text-sm font-medium">{t('kind')}</legend>
              <div className="mt-2 space-y-2">
                {preview.companyKinds.map((k) => (
                  <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${k === kind ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <input type="radio" name="kind" value={k} checked={k === kind} onChange={() => setKind(k)} className="mt-0.5" />
                    <span>
                      <span className="block font-semibold">{tKinds.has(`${k}.title`) ? tKinds(`${k}.title`) : k}</span>
                      {tKinds.has(`${k}.description`) && <span className="block text-xs text-muted-foreground">{tKinds(`${k}.description`)}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && <Banner tone="err" title={error} />}
          <button type="submit" disabled={busy || disabled} className={`${buttonClass.primary} w-full`}>
            {busy ? t('joining') : t('join')}
          </button>
          <p className="text-xs text-muted-foreground">{t('privacy')}</p>
          <button type="button" onClick={() => setMode('reenter')} className="text-sm font-semibold text-primary hover:underline">
            {t('haveCode')}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send('reenter', { personalCode: personalCode.trim() });
          }}
          className="mt-4 space-y-4"
        >
          <label className="block text-sm font-medium">
            {t('personalCode')}
            <input
              value={personalCode}
              onChange={(e) => setPersonalCode(e.target.value)}
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={`${inputClass} mt-1 font-mono tracking-widest`}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('personalCodeHint')}</span>
          </label>
          {error && <Banner tone="err" title={error} />}
          <button type="submit" disabled={busy || disabled} className={`${buttonClass.primary} w-full`}>
            {t('reenter')}
          </button>
          {canJoin && (
            <button type="button" onClick={() => setMode('join')} className="text-sm font-semibold text-primary hover:underline">
              {t('newHere')}
            </button>
          )}
        </form>
      )}
    </div>
  );
}
