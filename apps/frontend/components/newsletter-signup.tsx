'use client';

import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Banner } from '@/components/banner';
import { Link } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { NEWSLETTER_TOPICS, type NewsletterCountry, type NewsletterSource, type NewsletterTopic } from '@/lib/newsletter';

/**
 * Newsletter signup for the public pages (blog, guides, calculators, the SK
 * e-invoicing article). Double opt-in: this only asks the backend to send a
 * confirmation e-mail; nothing else is sent until the link in it is opened
 * and confirmed. The consent wording stored as evidence is taken by the
 * server route from the same messages shown here, never from the browser.
 */
export function NewsletterSignup({
  source,
  country: presetCountry,
  topics: presetTopics,
  className = ''
}: {
  source: NewsletterSource;
  country?: NewsletterCountry;
  topics?: NewsletterTopic[];
  className?: string;
}) {
  const t = useTranslations('newsletter.signup');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<NewsletterCountry>(presetCountry ?? (locale === 'sk' ? 'SK' : 'CZ'));
  const [topics, setTopics] = useState<NewsletterTopic[]>(
    presetTopics ?? (country === 'SK' ? [...NEWSLETTER_TOPICS] : NEWSLETTER_TOPICS.filter((x) => x !== 'sk_einvoicing'))
  );
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const toggle = (topic: NewsletterTopic) =>
    setTopics((cur) => (cur.includes(topic) ? cur.filter((x) => x !== topic) : [...cur, topic]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!topics.length) return setError('no_topics');
    if (!consent) return setError('consent_required');
    setState('busy');
    try {
      const res = await fetch('/api/public/newsletter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, locale, country, topics, source, consent, website })
      });
      if (res.ok) return setState('sent');
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(res.status === 429 ? 'rate_limited' : body?.error === 'invalid_email' ? 'invalid_email' : 'failed');
    } catch {
      setError('failed');
    }
    setState('idle');
  };

  if (state === 'sent') {
    return (
      <section className={`rounded-xl border border-border bg-card p-6 ${className}`}>
        <p className="flex items-center gap-2 font-semibold">
          <MailCheck className="h-5 w-5 text-primary" />
          {t('sentTitle')}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{t('sentBody')}</p>
      </section>
    );
  }

  return (
    <section className={`rounded-xl border border-border bg-card p-6 ${className}`} aria-labelledby="newsletter-signup-title">
      <h2 id="newsletter-signup-title" className="text-lg font-semibold">
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('body')}</p>
      <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block text-sm">
            <span className="sr-only">{t('email')}</span>
            <input
              type="email"
              required
              maxLength={320}
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
              aria-label={t('email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="sr-only">{t('country')}</span>
            <select
              aria-label={t('country')}
              value={country}
              onChange={(e) => setCountry(e.target.value as NewsletterCountry)}
              className={inputClass}
            >
              <option value="CZ">{t('countries.CZ')}</option>
              <option value="SK">{t('countries.SK')}</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{t('topicsLabel')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {NEWSLETTER_TOPICS.map((topic) => (
              <label key={topic} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={topics.includes(topic)} onChange={() => toggle(topic)} className="h-4 w-4 accent-primary" />
                {t(`topics.${topic}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {/* Honeypot: hidden from people, bots fill it and get a silent "ok". */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
          <span>{t('consent')}</span>
        </label>
        <p className="text-xs text-muted-foreground">
          {t.rich('privacy', { link: (chunks) => <Link href="/legal/privacy" className="text-primary hover:underline">{chunks}</Link> })}
        </p>
        {error && <Banner tone="err" title={t(`errors.${error}`)} />}
        <button type="submit" className={buttonClass.primary} disabled={state === 'busy'}>
          {state === 'busy' && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('submit')}
        </button>
      </form>
    </section>
  );
}
