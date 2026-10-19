'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Eye, Pencil, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  deleteBlogPost,
  draftBrief,
  draftNextTopic,
  draftTaxDeadlines,
  publishBlogPost,
  rejectBlogPost,
  saveBlogPost,
  setBlogAutopublish,
  unpublishBlogPost,
  type AdminBlogResult
} from '@/app/[locale]/(dashboard)/admin/blog/actions';
import { Banner } from '@/components/banner';
import { BlogMarkdown } from '@/components/blog-markdown';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { useRouter } from '@/i18n/navigation';
import { AUTO_PUBLISH_KINDS, TOPIC_KINDS, type AdminBlogPost, type BlogAutopublish, type TopicKind } from '@/lib/admin-blog';
import type { BlogSource } from '@/lib/blog';

/** One source per line as "Title | https://…", the easiest shape to paste. */
function parseSources(text: string): BlogSource[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.lastIndexOf('|');
      return at < 0 ? { title: line, url: line } : { title: line.slice(0, at).trim(), url: line.slice(at + 1).trim() };
    });
}

const formatSources = (sources: BlogSource[]) => sources.map((s) => `${s.title} | ${s.url}`).join('\n');

const KNOWN_ERRORS = [
  'post_has_warnings',
  'slug_taken',
  'weekly_draft_limit',
  'ai_platform_unavailable',
  'ai_refused',
  'ai_unparseable'
] as const;

function useErrorText() {
  const t = useTranslations('adminBlog.errors');
  return (code: string) => ((KNOWN_ERRORS as readonly string[]).includes(code) ? t(code as (typeof KNOWN_ERRORS)[number]) : t('generic', { code }));
}

const label = 'block text-xs font-bold uppercase tracking-wider text-muted-foreground';

/**
 * Generators that write from our own data: a switch per kind to let clean
 * drafts go live on their own, and a button to draft the next topic now.
 * Whatever the switch says, a draft with warnings or about a changing law
 * waits for a click, and at most `weeklyLimit` posts a week per language
 * publish on their own.
 */
export function BlogAutomation({ autopublish }: { autopublish: BlogAutopublish }) {
  const t = useTranslations('adminBlog');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [settings, setSettings] = useState(autopublish.settings);
  const [kind, setKind] = useState<TopicKind>('tool_howto');
  const [locale, setLocale] = useState<'cs' | 'sk'>('cs');

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-1.5 font-bold">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('autopublish.title')}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('autopublish.hint', { n: autopublish.weeklyLimit })}</p>
      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {AUTO_PUBLISH_KINDS.map((k) => (
          <li key={k}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t(`kind.${k}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`autopublish.kinds.${k}`)}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="h-5 w-5 accent-primary"
                checked={settings[k]}
                disabled={pending}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  start(async () => {
                    const res = await setBlogAutopublish(k, enabled);
                    if (!res.ok) return toast({ text: errorText(res.error), tone: 'err' });
                    setSettings(res.data.settings);
                    toast({ text: t(enabled ? 'autopublish.on' : 'autopublish.off'), tone: 'ok' });
                  });
                }}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('autopublish.thisWeek', { cs: autopublish.thisWeek.cs, sk: autopublish.thisWeek.sk, n: autopublish.weeklyLimit })}
      </p>

      <form
        className="mt-4 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await draftNextTopic(kind, locale);
            if (!res.ok) return toast({ text: errorText(res.error), tone: 'err' });
            if (!res.data) return toast({ text: t('autopublish.allWritten'), tone: 'info' });
            toast({ text: t(res.data.status === 'published' ? 'autopublish.published' : 'drafts.created'), tone: 'ok' });
            router.push(`/admin/blog/${res.data.id}`);
          });
        }}
      >
        <label className="flex-1">
          <span className={label}>{t('autopublish.topic')}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TopicKind)} className={inputClass}>
            {TOPIC_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>{t('fields.locale')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as 'cs' | 'sk')} className={inputClass}>
            <option value="cs">cs</option>
            <option value="sk">sk</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {t('autopublish.draftNext')}
        </button>
      </form>
    </section>
  );
}

/** The two on-demand AI generators. Their drafts go live only by the rules in BlogAutomation. */
export function BlogDraftForms() {
  const t = useTranslations('adminBlog');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [year, setYear] = useState(next.getFullYear());
  const [month, setMonth] = useState(next.getMonth() + 1);
  const [brief, setBrief] = useState({ locale: 'cs', topic: '', facts: '', sources: '' });

  function done(res: AdminBlogResult<AdminBlogPost | null>) {
    if (!res.ok) return toast({ text: errorText(res.error), tone: 'err' });
    if (!res.data) return toast({ text: t('drafts.nothingNew'), tone: 'info' });
    toast({ text: t('drafts.created'), tone: 'ok' });
    router.push(`/admin/blog/${res.data.id}`);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        className="rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => done(await draftTaxDeadlines(year, month)));
        }}
      >
        <h2 className="flex items-center gap-1.5 font-bold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('drafts.taxTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('drafts.taxHint')}</p>
        <div className="mt-3 flex gap-2">
          <label className="flex-1">
            <span className={label}>{t('drafts.year')}</span>
            <input type="number" min={2024} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className={inputClass} />
          </label>
          <label className="flex-1">
            <span className={label}>{t('drafts.month')}</span>
            <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputClass} />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} mt-3`}>
          {t('drafts.generate')}
        </button>
      </form>

      <form
        className="rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => done(await draftBrief({ ...brief, sources: parseSources(brief.sources) })));
        }}
      >
        <h2 className="flex items-center gap-1.5 font-bold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('drafts.briefTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('drafts.briefHint')}</p>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className={label}>{t('fields.locale')}</span>
            <select value={brief.locale} onChange={(e) => setBrief({ ...brief, locale: e.target.value })} className={inputClass}>
              <option value="cs">cs</option>
              <option value="sk">sk</option>
              <option value="en">en</option>
            </select>
          </label>
          <label className="block">
            <span className={label}>{t('drafts.topic')}</span>
            <input required minLength={5} maxLength={500} value={brief.topic} onChange={(e) => setBrief({ ...brief, topic: e.target.value })} className={inputClass} />
          </label>
          <label className="block">
            <span className={label}>{t('fields.facts')}</span>
            <textarea required minLength={20} rows={4} value={brief.facts} onChange={(e) => setBrief({ ...brief, facts: e.target.value })} className={inputClass} />
          </label>
          <label className="block">
            <span className={label}>{t('fields.sources')}</span>
            <textarea required rows={2} value={brief.sources} onChange={(e) => setBrief({ ...brief, sources: e.target.value })} placeholder={t('fields.sourcesPlaceholder')} className={inputClass} />
          </label>
        </div>
        <button type="submit" disabled={pending} className={`${buttonClass.primary} mt-3`}>
          {t('drafts.generate')}
        </button>
      </form>
    </div>
  );
}

/** Edit, preview and review one post. Publishing a post with warnings needs an explicit tick. */
export function BlogPostEditor({ post }: { post: AdminBlogPost }) {
  const t = useTranslations('adminBlog');
  const errorText = useErrorText();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState(false);
  const [force, setForce] = useState(false);
  const [form, setForm] = useState({
    locale: post.locale as string,
    slug: post.slug,
    translation_key: post.translationKey,
    title: post.title,
    description: post.description,
    body: post.body,
    sources: formatSources(post.sources),
    facts: post.facts ?? ''
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  function act(fn: () => Promise<AdminBlogResult<unknown>>, ok: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast({ text: errorText(res.error), tone: 'err' });
        return;
      }
      toast({ text: ok, tone: 'ok' });
      setForce(false);
      if (after) after();
      else router.refresh();
    });
  }

  const save = () =>
    saveBlogPost(post.id, { ...form, sources: parseSources(form.sources), facts: form.facts.trim() ? form.facts : null });

  return (
    <div className="space-y-4">
      {post.warnings.length > 0 && (
        <Banner tone="warn" title={t('warningsTitle')}>
          <ul className="mt-1 list-disc pl-5">
            {post.warnings.map((w) => (
              <li key={w}>{t.has(`warnings.${w}`) ? t(`warnings.${w}`) : w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t('warningsAfterSave')}</p>
        </Banner>
      )}

      <div className="flex gap-1 rounded-full border border-border bg-card p-1 text-sm sm:w-fit">
        <button type="button" onClick={() => setPreview(false)} className={`${preview ? buttonClass.ghost : buttonClass.primary} flex-1`}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t('edit')}
        </button>
        <button type="button" onClick={() => setPreview(true)} className={`${preview ? buttonClass.primary : buttonClass.ghost} flex-1`}>
          <Eye className="h-4 w-4" aria-hidden="true" />
          {t('preview')}
        </button>
      </div>

      {preview ? (
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-2xl font-extrabold tracking-tight">{form.title}</h2>
          <p className="mt-3 text-muted-foreground">{form.description}</p>
          <div className="mt-6">
            <BlogMarkdown body={form.body} />
          </div>
        </article>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[6rem_1fr_1fr]">
            <label className="block">
              <span className={label}>{t('fields.locale')}</span>
              <select value={form.locale} onChange={set('locale')} className={inputClass}>
                <option value="cs">cs</option>
                <option value="sk">sk</option>
                <option value="en">en</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>{t('fields.slug')}</span>
              <input value={form.slug} onChange={set('slug')} className={inputClass} />
            </label>
            <label className="block">
              <span className={label}>{t('fields.translationKey')}</span>
              <input value={form.translation_key} onChange={set('translation_key')} className={inputClass} />
            </label>
          </div>
          <label className="block">
            <span className={label}>{t('fields.title')}</span>
            <input value={form.title} onChange={set('title')} className={inputClass} />
          </label>
          <label className="block">
            <span className={label}>{t('fields.description')}</span>
            <textarea rows={2} value={form.description} onChange={set('description')} className={inputClass} />
          </label>
          <label className="block">
            <span className={label}>{t('fields.body')}</span>
            <textarea rows={18} value={form.body} onChange={set('body')} className={`${inputClass} font-mono text-xs`} />
            <span className="mt-1 block text-xs text-muted-foreground">{t('fields.bodyHint')}</span>
          </label>
          <label className="block">
            <span className={label}>{t('fields.sources')}</span>
            <textarea rows={3} value={form.sources} onChange={set('sources')} placeholder={t('fields.sourcesPlaceholder')} className={`${inputClass} text-xs`} />
          </label>
          <label className="block">
            <span className={label}>{t('fields.facts')}</span>
            <textarea rows={4} value={form.facts} onChange={set('facts')} className={`${inputClass} text-xs`} />
            <span className="mt-1 block text-xs text-muted-foreground">{t('fields.factsHint')}</span>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={() => act(save, t('saved'))} className={buttonClass.secondary}>
          {t('save')}
        </button>
        {post.status !== 'published' ? (
          <>
            {post.warnings.length > 0 && (
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                {t('publishAnyway')}
              </label>
            )}
            <button
              type="button"
              disabled={pending || (post.warnings.length > 0 && !force)}
              onClick={() => act(() => publishBlogPost(post.id, force), t('published'))}
              className={buttonClass.primary}
            >
              {t('publish')}
            </button>
            {post.status !== 'rejected' && (
              <button type="button" disabled={pending} onClick={() => act(() => rejectBlogPost(post.id), t('rejected'))} className={buttonClass.ghost}>
                {t('reject')}
              </button>
            )}
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => act(() => unpublishBlogPost(post.id), t('unpublished'))} className={buttonClass.secondary}>
            {t('unpublish')}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(t('deleteConfirm'))) act(() => deleteBlogPost(post.id), t('deleted'), () => router.push('/admin/blog'));
          }}
          className={`${buttonClass.ghost} ml-auto text-destructive`}
        >
          {t('delete')}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">{t('saveBeforePublish')}</p>
    </div>
  );
}
