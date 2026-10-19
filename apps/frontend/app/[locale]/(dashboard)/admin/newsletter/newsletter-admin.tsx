'use client';

import { useState, useTransition } from 'react';
import { Eye, Loader2, Pencil, Send, Sparkles, Trash2, X } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { NEWSLETTER_TOPICS, type NewsletterCountry, type NewsletterTopic } from '@/lib/newsletter';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import {
  createDraftIssue,
  createIssue,
  deleteIssue,
  getIssue,
  previewIssue,
  sendIssue,
  updateIssue,
  type AdminIssue,
  type IssueInput
} from './actions';

export interface NewsletterStats {
  segments: { status: 'pending' | 'confirmed' | 'unsubscribed'; country: NewsletterCountry; locale: string; n: number }[];
  topics: { topic: string; n: number }[];
}

const LOCALES = ['cs', 'sk', 'en'] as const;
const EMPTY: IssueInput = { locale: 'cs', country: null, topics: [...NEWSLETTER_TOPICS], subject: '', body: '' };

export function NewsletterAdmin({ stats, issues }: { stats: NewsletterStats; issues: AdminIssue[] }) {
  const t = useTranslations('adminNewsletter');
  const tSignup = useTranslations('newsletter.signup');
  const format = useFormatter();
  const router = useRouter();
  const [pending, start] = useTransition();
  /** The issue being edited: `null` = none open, no id = a new one not saved yet. */
  const [editing, setEditing] = useState<(IssueInput & { id?: string; status?: AdminIssue['status']; audience?: number }) | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const fail = (error: string) => toast({ text: t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.failed'), tone: 'err' });

  const total = (status: string) => stats.segments.filter((s) => s.status === status).reduce((sum, s) => sum + s.n, 0);
  const byCountry = (status: string, country: string) =>
    stats.segments.filter((s) => s.status === status && s.country === country).reduce((sum, s) => sum + s.n, 0);

  const open = (id: string) =>
    start(async () => {
      const r = await getIssue(id);
      if (!r.ok) return fail(r.error);
      setPreview(null);
      setEditing(r.data);
    });

  const draft = (locale: IssueInput['locale'], country: NewsletterCountry | null) =>
    start(async () => {
      const r = await createDraftIssue(locale, country);
      if (!r.ok) return fail(r.error);
      setPreview(null);
      setEditing(r.data);
      router.refresh();
    });

  const save = (then?: (issue: AdminIssue) => Promise<void> | void) =>
    start(async () => {
      if (!editing) return;
      const input: IssueInput = { locale: editing.locale, country: editing.country, topics: editing.topics, subject: editing.subject, body: editing.body };
      const r = editing.id ? await updateIssue(editing.id, input) : await createIssue(input);
      if (!r.ok) return fail(r.error);
      setEditing(r.data);
      toast({ text: t('saved'), tone: 'ok' });
      router.refresh();
      await then?.(r.data);
    });

  const loadPreview = async (id: string) => {
    const r = await previewIssue(id);
    if (!r.ok) return fail(r.error);
    setPreview(r.data.html);
  };
  // A sent issue can't be saved, only looked at.
  const showPreview = () => (readOnly && editing?.id ? start(() => loadPreview(editing.id!)) : save((issue) => loadPreview(issue.id)));

  const send = () => {
    if (!editing?.id) return;
    if (!window.confirm(t('sendConfirm', { count: editing.audience ?? 0 }))) return;
    const id = editing.id;
    start(async () => {
      const r = await sendIssue(id);
      if (!r.ok) return fail(r.error);
      toast({ text: t('sendStarted'), tone: 'ok' });
      setEditing(null);
      setPreview(null);
      router.refresh();
    });
  };

  const remove = () => {
    if (!editing?.id || !window.confirm(t('deleteConfirm'))) return;
    const id = editing.id;
    start(async () => {
      const r = await deleteIssue(id);
      if (!r.ok) return fail(r.error);
      setEditing(null);
      setPreview(null);
      router.refresh();
    });
  };

  const toggleTopic = (topic: NewsletterTopic) => {
    if (!editing) return;
    const topics = editing.topics.includes(topic) ? editing.topics.filter((x) => x !== topic) : [...editing.topics, topic];
    if (topics.length) setEditing({ ...editing, topics });
  };

  const readOnly = !!editing?.status && editing.status !== 'draft';
  const card = 'mt-6 rounded-xl border border-border bg-card p-5';

  return (
    <>
      <section className={card}>
        <h2 className="font-bold">{t('stats')}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(['confirmed', 'pending', 'unsubscribed'] as const).map((status) => (
            <div key={status} className="rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">{t(`statuses.${status}`)}</p>
              <p className="text-2xl font-bold">{total(status)}</p>
              <p className="text-xs text-muted-foreground">
                CZ {byCountry(status, 'CZ')} · SK {byCountry(status, 'SK')}
              </p>
            </div>
          ))}
        </div>
        {stats.topics.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('topicCounts')}:{' '}
            {stats.topics.map((x) => `${tSignup.has(`topics.${x.topic}`) ? tSignup(`topics.${x.topic}`) : x.topic} ${x.n}`).join(' · ')}
          </p>
        )}
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => (setPreview(null), setEditing({ ...EMPTY }))}>
            <Pencil className="h-4 w-4" />
            {t('newIssue')}
          </button>
          {LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              className={buttonClass.secondary}
              disabled={pending}
              onClick={() => draft(locale, locale === 'sk' ? 'SK' : locale === 'cs' ? 'CZ' : null)}
            >
              <Sparkles className="h-4 w-4" />
              {t('draftFromBlog')} ({locale.toUpperCase()})
            </button>
          ))}
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </section>

      {editing && (
        <section className={card}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold">
              {editing.id ? editing.subject || t('newIssue') : t('newIssue')}
              {editing.status && <span className="ml-2 text-xs font-normal text-muted-foreground">{t(`issueStatuses.${editing.status}`)}</span>}
            </h2>
            <button type="button" className={buttonClass.ghost} onClick={() => (setEditing(null), setPreview(null))} aria-label={t('close')}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <fieldset disabled={readOnly || pending} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('locale')}</span>
                <select className={inputClass} value={editing.locale} onChange={(e) => setEditing({ ...editing, locale: e.target.value as IssueInput['locale'] })}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l}>
                      {l.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('country')}</span>
                <select
                  className={inputClass}
                  value={editing.country ?? ''}
                  onChange={(e) => setEditing({ ...editing, country: (e.target.value || null) as NewsletterCountry | null })}
                >
                  <option value="">{t('allCountries')}</option>
                  <option value="CZ">{tSignup('countries.CZ')}</option>
                  <option value="SK">{tSignup('countries.SK')}</option>
                </select>
              </label>
            </div>
            <fieldset className="text-sm">
              <legend className="mb-1 block text-xs font-semibold text-muted-foreground">{t('topics')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {NEWSLETTER_TOPICS.map((topic) => (
                  <label key={topic} className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={editing.topics.includes(topic)} onChange={() => toggleTopic(topic)} />
                    {tSignup(`topics.${topic}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('subject')}</span>
              <input className={inputClass} maxLength={200} value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">{t('body')}</span>
              <textarea
                className={cn(inputClass, 'min-h-[320px] font-mono text-xs')}
                maxLength={50000}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              />
            </label>
          </fieldset>
          {editing.id && editing.audience !== undefined && (
            <p className="mt-3 text-sm text-muted-foreground">{t('audience', { count: editing.audience })}</p>
          )}
          {readOnly && !preview && (
            <button type="button" className={`${buttonClass.secondary} mt-4`} disabled={pending} onClick={showPreview}>
              <Eye className="h-4 w-4" />
              {t('preview')}
            </button>
          )}
          {!readOnly && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => save()}>
                {t('save')}
              </button>
              <button type="button" className={buttonClass.secondary} disabled={pending} onClick={showPreview}>
                <Eye className="h-4 w-4" />
                {t('preview')}
              </button>
              {editing.id && (
                <button type="button" className={buttonClass.primary} disabled={pending} onClick={send}>
                  <Send className="h-4 w-4" />
                  {t('send')}
                </button>
              )}
              {editing.id && (
                <button type="button" className={buttonClass.ghost} disabled={pending} onClick={remove}>
                  <Trash2 className="h-4 w-4" />
                  {t('delete')}
                </button>
              )}
            </div>
          )}
          {preview && (
            // The rendered e-mail, isolated: no scripts, no same-origin access.
            <iframe title={t('preview')} sandbox="" srcDoc={preview} className="mt-4 h-[600px] w-full rounded-lg border border-border bg-white" />
          )}
        </section>
      )}

      <section className={card}>
        <h2 className="font-bold">{t('issues')}</h2>
        {issues.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noIssues')}</p>
        ) : (
          <ul className="mt-3">
            {issues.map((issue) => (
              <li key={issue.id} className="flex items-center justify-between gap-3 border-t border-border/60 py-2.5 text-sm first:border-t-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{issue.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`issueStatuses.${issue.status}`)} · {issue.locale.toUpperCase()} · {issue.country ?? 'CZ+SK'} ·{' '}
                    {format.dateTime(new Date(issue.sentAt ?? issue.createdAt), { dateStyle: 'medium' })}
                    {issue.status !== 'draft' && ` · ${t('queued', { count: issue.queuedCount })}`}
                  </p>
                </div>
                <button type="button" className={buttonClass.ghost} disabled={pending} onClick={() => open(issue.id)}>
                  {issue.status === 'draft' ? t('edit') : t('preview')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
