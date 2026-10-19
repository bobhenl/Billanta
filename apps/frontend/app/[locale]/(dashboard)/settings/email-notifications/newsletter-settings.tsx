'use client';

import { useState, useTransition } from 'react';
import { Loader2, Newspaper } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InfoHint } from '@/components/info-hint';
import { toast } from '@/components/toaster';
import { inputClass } from '@/lib/ui-classes';
import { NEWSLETTER_TOPICS, type NewsletterCountry, type NewsletterTopic } from '@/lib/newsletter';
import { saveMyNewsletter, type MyNewsletter } from '@/lib/newsletter-actions';
import { cn } from '@/lib/utils';
import { Toggle } from './email-notification-settings';

/**
 * The Billanta newsletter for the signed-in member. Separate from the
 * notification switches above: it is a commercial communication, so it is
 * opt-in with the consent wording shown next to the switch. A verified
 * account e-mail is subscribed at once; otherwise a confirmation e-mail
 * goes out first.
 */
export function NewsletterSettings({ initial }: { initial: MyNewsletter }) {
  const t = useTranslations('newsletter.settings');
  const tSignup = useTranslations('newsletter.signup');
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  const on = state.status === 'confirmed' || state.status === 'pending';

  const save = (patch: { subscribed: boolean; topics?: NewsletterTopic[]; country?: NewsletterCountry }, optimistic: MyNewsletter) => {
    const before = state;
    setState(optimistic);
    start(async () => {
      const result = await saveMyNewsletter(patch);
      if (result.ok) {
        setState(result.data);
        toast({ text: t('saved'), tone: 'ok' });
      } else {
        setState(before);
        toast({ text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.failed'), tone: 'err' });
      }
    });
  };

  const toggleTopic = (topic: NewsletterTopic) => {
    const topics = state.topics.includes(topic) ? state.topics.filter((x) => x !== topic) : [...state.topics, topic];
    if (!topics.length) return;
    if (on) save({ subscribed: true, topics }, { ...state, topics });
    else setState({ ...state, topics });
  };

  const setCountry = (country: NewsletterCountry) => {
    if (on) save({ subscribed: true, country }, { ...state, country });
    else setState({ ...state, country });
  };

  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <InfoHint hint={t('hint')}>
          <h2 className="flex items-center gap-2 font-bold">
            <Newspaper className="h-4 w-4 text-primary" />
            {t('title')}
          </h2>
        </InfoHint>
        {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <Toggle
          on={on}
          label={t('toggle')}
          onChange={() =>
            on
              ? save({ subscribed: false }, { ...state, status: 'unsubscribed' })
              : save({ subscribed: true, topics: state.topics, country: state.country }, { ...state, status: 'pending' })
          }
        />
        {t('toggle')}
      </label>
      {!on && <p className="mt-2 text-xs text-muted-foreground">{t('consent')}</p>}
      {state.status === 'pending' && <p className="mt-2 text-xs text-muted-foreground">{t('pending')}</p>}
      <div className={cn('mt-4 grid gap-4 sm:grid-cols-[auto_1fr]', pending && 'opacity-60')}>
        <label className="text-sm">
          <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('country')}</span>
          <select className={inputClass} value={state.country} disabled={pending} onChange={(e) => setCountry(e.target.value as NewsletterCountry)}>
            <option value="CZ">{tSignup('countries.CZ')}</option>
            <option value="SK">{tSignup('countries.SK')}</option>
          </select>
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1 block text-xs font-semibold text-muted-foreground">{t('topics')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {NEWSLETTER_TOPICS.map((topic) => (
              <label key={topic} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={state.topics.includes(topic)}
                  disabled={pending}
                  onChange={() => toggleTopic(topic)}
                />
                {tSignup(`topics.${topic}`)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}
