'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, KeyRound, Loader2, Mail, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Modal, buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeSegment } from '@/components/theme-toggle';
import { changePassword, deleteAccount, requestEmailChange, updateProfileName } from './actions';

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', seznam: 'Seznam', discord: 'Discord' };

export function ProfileForms({
  name: initialName,
  email,
  hasPassword,
  memberSince,
  providers
}: {
  name: string;
  email: string;
  hasPassword: boolean;
  memberSince: string;
  providers: string[];
}) {
  const t = useTranslations('settings.profile');
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingName, startName] = useTransition();
  const [savingPassword, startPassword] = useTransition();
  const initial = (name || email).trim().charAt(0).toUpperCase();
  const locale = useLocale();
  const [emailForm, setEmailForm] = useState<{ email: string; password: string } | null>(null);
  const [emailPending, startEmail] = useTransition();
  const [deleteForm, setDeleteForm] = useState<{ email: string; password: string } | null>(null);
  const [deletePending, startDelete] = useTransition();

  const submitEmailChange = () => {
    if (!emailForm) return;
    startEmail(async () => {
      const result = await requestEmailChange(emailForm.password, emailForm.email, locale);
      if (result.ok) {
        toast({ text: t('emailChange.sent', { email: emailForm.email.trim() }), tone: 'ok' });
        setEmailForm(null);
      } else {
        toast({ text: t(`errors.${result.error}`), tone: 'err' });
      }
    });
  };

  const submitDelete = () => {
    if (!deleteForm) return;
    startDelete(async () => {
      const result = await deleteAccount(deleteForm.password, deleteForm.email);
      if (result.ok) {
        window.location.href = `/${locale}`;
        return;
      }
      toast({ text: t(`errors.${result.error}`, { company: result.company ?? '' }), tone: 'err' });
    });
  };

  const saveName = () =>
    startName(async () => {
      const result = await updateProfileName(name);
      toast(result.ok ? { text: t('nameSaved'), tone: 'ok' } : { text: t(`errors.${result.error}`), tone: 'err' });
      if (result.ok) router.refresh();
    });

  const savePassword = () => {
    if (next !== confirm) {
      toast({ text: t('errors.mismatch'), tone: 'err' });
      return;
    }
    startPassword(async () => {
      const result = await changePassword(current, next);
      if (result.ok) {
        toast({ text: t('passwordSaved'), tone: 'ok' });
        setCurrent('');
        setNext('');
        setConfirm('');
        router.refresh();
      } else {
        toast({ text: t(`errors.${result.error}`), tone: 'err' });
      }
    });
  };

  return (
    <div className="mt-6 space-y-5">
      <section className="flex items-center gap-4 rounded-xl border border-border bg-card p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-primary-foreground">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{name || email}</p>
          {name && (
            <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Mail className="h-3.5 w-3.5" />
              {email}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">{t('memberSince', { date: memberSince })}</p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-bold">{t('personal')}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('name')}</span>
            <input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('email')}</span>
            <div className="flex gap-2">
              <input className={`${inputClass} cursor-not-allowed opacity-70`} value={email} readOnly />
              <button type="button" className={buttonClass.secondary} onClick={() => setEmailForm({ email: '', password: '' })}>
                {t('emailChange.button')}
              </button>
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">{t('emailChange.hint')}</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonClass.primary} disabled={savingName || name === initialName} onClick={saveName}>
            {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('save')}
          </button>
        </div>
      </section>

      <section id="password" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <KeyRound className="h-4 w-4 text-primary" />
          {hasPassword ? t('changePassword') : t('setPassword')}
        </h2>
        {!hasPassword && <p className="mt-1 text-xs text-muted-foreground">{t('setPasswordHint')}</p>}
        <form
          className="mt-4 grid gap-4 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword();
          }}
        >
          {hasPassword && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t('currentPassword')}</span>
              <input type="password" autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('newPassword')}</span>
            <input type="password" autoComplete="new-password" minLength={8} className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('confirmPassword')}</span>
            <input type="password" autoComplete="new-password" minLength={8} className={inputClass} value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <div className="flex items-center justify-between gap-3 sm:col-span-3">
            <span className="text-xs text-muted-foreground">{t('passwordRules')}</span>
            <button type="submit" className={buttonClass.primary} disabled={savingPassword || !next}>
              {savingPassword && <Loader2 className="h-4 w-4 animate-spin" />}
              {hasPassword ? t('changePassword') : t('setPassword')}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          {t('signInMethods')}
        </h2>
        <ul className="mt-3 divide-y divide-border text-sm">
          <li className="flex items-center justify-between py-2">
            <span>{t('methodPassword')}</span>
            <span className={hasPassword ? 'font-semibold text-success' : 'text-muted-foreground'}>{hasPassword ? t('active') : t('notSet')}</span>
          </li>
          {providers.map((p) => (
            <li key={p} className="flex items-center justify-between py-2">
              <span>{PROVIDER_LABELS[p] ?? p}</span>
              <span className="font-semibold text-success">{t('linked')}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="preferences" className="scroll-mt-20 rounded-xl border border-border bg-card p-5">
        <h2 className="font-bold">{t('preferences')}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-6 text-sm">
          <div>
            <span className="mb-1.5 block font-medium">{t('language')}</span>
            <LanguageSwitcher />
          </div>
          <div>
            <span className="mb-1.5 block font-medium">{t('theme')}</span>
            <ThemeSegment />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-destructive/40 bg-card p-5">
        <h2 className="flex items-center gap-2 font-bold text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {t('danger.title')}
        </h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">{t('danger.body')}</p>
          <button type="button" className={buttonClass.danger} onClick={() => setDeleteForm({ email: '', password: '' })}>
            <Trash2 className="h-4 w-4" />
            {t('danger.button')}
          </button>
        </div>
      </section>

      <Modal
        open={emailForm !== null}
        onClose={() => setEmailForm(null)}
        title={t('emailChange.title')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setEmailForm(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={buttonClass.primary}
              disabled={emailPending || !emailForm?.email.trim() || (hasPassword && !emailForm?.password)}
              onClick={submitEmailChange}
            >
              {emailPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('emailChange.submit')}
            </button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{t('emailChange.body')}</p>
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t('emailChange.newEmail')}</span>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              className={inputClass}
              value={emailForm?.email ?? ''}
              onChange={(e) => setEmailForm((f) => f && { ...f, email: e.target.value })}
            />
          </label>
          {hasPassword && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t('currentPassword')}</span>
              <input
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={emailForm?.password ?? ''}
                onChange={(e) => setEmailForm((f) => f && { ...f, password: e.target.value })}
              />
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={deleteForm !== null}
        onClose={() => setDeleteForm(null)}
        title={t('danger.modalTitle')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setDeleteForm(null)}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={buttonClass.danger}
              disabled={deletePending || deleteForm?.email.trim().toLowerCase() !== email.toLowerCase() || (hasPassword && !deleteForm?.password)}
              onClick={submitDelete}
            >
              {deletePending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('danger.confirm')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>{t('danger.modalBody')}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t('danger.pointSolo')}</li>
            <li>{t('danger.pointShared')}</li>
            <li>{t('danger.pointBackup')}</li>
          </ul>
          <label className="block">
            <span className="mb-1 block font-medium">{t('danger.typeEmail', { email })}</span>
            <input
              className={inputClass}
              autoComplete="off"
              value={deleteForm?.email ?? ''}
              onChange={(e) => setDeleteForm((f) => f && { ...f, email: e.target.value })}
            />
          </label>
          {hasPassword && (
            <label className="block">
              <span className="mb-1 block font-medium">{t('currentPassword')}</span>
              <input
                type="password"
                autoComplete="current-password"
                className={inputClass}
                value={deleteForm?.password ?? ''}
                onChange={(e) => setDeleteForm((f) => f && { ...f, password: e.target.value })}
              />
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
