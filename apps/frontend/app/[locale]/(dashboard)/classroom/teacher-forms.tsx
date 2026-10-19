'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { CLASSROOM_TRACKS, type ClassroomTrack } from '@/lib/classroom';
import { DEMO_KINDS } from '@/lib/demo';
import { createClass, inviteColleague } from './actions';

/** The tracks' default company kinds, as the backend picks them (src/classroom/tracks.ts). */
function trackKinds(track: ClassroomTrack, country: 'CZ' | 'SK'): string[] {
  if (track === 'basic') return ['cz_freelancer', 'cz_pausal'];
  if (track === 'standard') return country === 'SK' ? ['sk_vat_sro', 'cz_vat_sro'] : ['cz_vat_sro', 'cz_freelancer'];
  return [...DEMO_KINDS];
}

/**
 * A new class: name, track (the school type only pre-selects it), the
 * students' language and which practice companies they may pick. The
 * track also fixes the modules; the backend keeps AI off.
 */
export function CreateClassForm({ suggestedTrack, defaultLanguage, country }: { suggestedTrack: ClassroomTrack; defaultLanguage: string; country: 'CZ' | 'SK' }) {
  const t = useTranslations('classroom.create');
  const tTracks = useTranslations('classroom.tracks');
  const tErr = useTranslations('classroom.errors');
  const tKinds = useTranslations('demo.kinds');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<ClassroomTrack>(suggestedTrack);
  const [kinds, setKinds] = useState<string[]>(() => trackKinds(suggestedTrack, country));

  function pickTrack(next: ClassroomTrack) {
    setTrack(next);
    setKinds(trackKinds(next, country));
  }

  function submit(form: FormData) {
    setError(null);
    const endsAt = String(form.get('endsAt') ?? '');
    start(async () => {
      const result = await createClass({
        name: String(form.get('name') ?? '').trim(),
        track,
        language: String(form.get('language')),
        kinds: kinds.length ? kinds : undefined,
        seeded: form.get('seeded') === 'on',
        endsAt: endsAt || undefined
      });
      if (!result.ok) {
        setError(tErr.has(result.error) ? tErr(result.error) : tErr('generic'));
        return;
      }
      router.push(`/classroom/${result.data.id}`);
    });
  }

  return (
    <form action={submit} className="mt-8 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-bold">{t('title')}</h2>
      <label className="block text-sm font-medium">
        {t('name')}
        <input name="name" required maxLength={80} placeholder={t('namePlaceholder')} className={`${inputClass} mt-1`} />
      </label>

      <fieldset>
        <legend className="text-sm font-medium">{t('track')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {CLASSROOM_TRACKS.map((tr) => (
            <label
              key={tr}
              className={`cursor-pointer rounded-lg border p-3 text-sm ${tr === track ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'}`}
            >
              <input type="radio" name="track" value={tr} checked={tr === track} onChange={() => pickTrack(tr)} className="sr-only" />
              <span className="block font-semibold">
                {tTracks(`${tr}.title`)}
                {tr === suggestedTrack && <span className="ml-1 text-xs font-normal text-primary">{t('suggested')}</span>}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">{tTracks(`${tr}.body`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">{t('kinds')}</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {DEMO_KINDS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={kinds.includes(k)}
                onChange={(e) => setKinds((list) => (e.target.checked ? [...list, k] : list.filter((x) => x !== k)))}
              />
              {tKinds(`${k}.title`)}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t('kindsHint')}</p>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t('language')}
          <select name="language" defaultValue={defaultLanguage} className={`${inputClass} mt-1`}>
            <option value="cs">Čeština</option>
            <option value="sk">Slovenčina</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('endsAt')}
          <input name="endsAt" type="date" className={`${inputClass} mt-1`} />
          <span className="mt-1 block text-xs font-normal text-muted-foreground">{t('endsAtHint')}</span>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="seeded" defaultChecked className="mt-1" />
        <span>
          {t('seeded')}
          <span className="block text-xs text-muted-foreground">{t('seededHint')}</span>
        </span>
      </label>
      {error && <Banner tone="err" title={error} />}
      <button type="submit" disabled={pending || kinds.length === 0} className={buttonClass.primary}>
        {t('submit')}
      </button>
    </form>
  );
}

/** Colleagues of the same school are approved straight away when an approved teacher invites them. */
export function InviteColleagueForm({ school }: { school: string }) {
  const t = useTranslations('classroom.invite');
  const tErr = useTranslations('classroom.errors');
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');

  function submit() {
    start(async () => {
      const result = await inviteColleague(email.trim());
      if (!result.ok) {
        toast({ text: tErr.has(result.error) ? tErr(result.error) : tErr('generic'), tone: 'err' });
        return;
      }
      toast({ text: t('sent'), tone: 'ok' });
      setEmail('');
    });
  }

  return (
    <form action={submit} className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-bold">{t('title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('body', { school })}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('placeholder')}
          className={inputClass}
        />
        <button type="submit" disabled={pending} className={buttonClass.secondary}>
          {t('submit')}
        </button>
      </div>
    </form>
  );
}
