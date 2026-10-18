'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, MessageSquare } from 'lucide-react';
import { buyerInputClass } from '@/components/buyer-fields';
import { sendProfileMessage } from '@/lib/public-profile-actions';

/** "Kontaktovat": a short message that reaches the company in its app notifications. */
export function ProfileMessageForm({
  slug,
  companyName,
  services
}: {
  slug: string;
  companyName: string;
  services: { id: string; title: string }[];
}) {
  const t = useTranslations('publicProfile.message');
  const [serviceId, setServiceId] = useState('');
  // `?ask=<id>` is read on the client so the profile page stays static.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('ask');
    if (id && services.some((s) => s.id === id)) setServiceId(id);
  }, [services]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    startTransition(async () => {
      const r = await sendProfileMessage(slug, { name, email, message, serviceId: serviceId || null, website });
      if (r.ok) {
        setSent(true);
        return;
      }
      if (r.fields) setFields(r.fields);
      setError(t(`errors.${r.error === 'invalid' || r.error === 'closed' || r.error === 'limit' || r.error === 'daily_cap' ? r.error : 'failed'}`));
    });
  };

  if (sent) {
    return (
      <div className="rounded-2xl border border-success/40 bg-card p-6" role="status">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <CheckCircle2 className="h-5 w-5 text-success" />
          {t('doneTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('doneText', { company: companyName })}</p>
      </div>
    );
  }

  const field = (key: string, label: string, node: React.ReactNode, wide = false) => (
    <label className={`text-sm ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block font-medium">{label}</span>
      {node}
      {fields[key] && <span className="mt-1 block text-xs text-destructive">{t(`errors.${key}`)}</span>}
    </label>
  );

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-6">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <MessageSquare className="h-5 w-5 text-primary" />
        {t('title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('hint', { company: companyName })}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field('name', t('name'), <input className={buyerInputClass} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" aria-invalid={Boolean(fields.name)} />)}
        {field(
          'email',
          t('email'),
          <input className={buyerInputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={200} autoComplete="email" aria-invalid={Boolean(fields.email)} />
        )}
        {services.length > 0 &&
          field(
            'serviceId',
            t('about'),
            <select className={buyerInputClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">{t('aboutGeneral')}</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>,
            true
          )}
        {field(
          'message',
          t('message'),
          <textarea
            className={`${buyerInputClass} h-auto py-2`}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            minLength={5}
            maxLength={2000}
            aria-invalid={Boolean(fields.message)}
          />,
          true
        )}
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {t('submit')}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{t('legal')}</p>
    </form>
  );
}
