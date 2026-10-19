'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { buttonClass, inputClass } from '@/components/modal';
import { SCHOOL_LEVELS } from '@/lib/classroom';
import { lookupCompanyById } from '@/lib/company-lookup-actions';
import { applyAsTeacher } from './actions';

/**
 * The teacher application: the school by IČO (the registry fills the name
 * and address), who the teacher is, and the click-through school terms.
 * Approval is instant on a verified school domain, else Billanta staff look.
 */
export function ApplyForm() {
  const t = useTranslations('classroom.apply');
  const tErr = useTranslations('classroom.errors');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState<'CZ' | 'SK'>('CZ');
  const [ico, setIco] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [address, setAddress] = useState('');
  const [looking, setLooking] = useState(false);

  async function lookup() {
    setLooking(true);
    const result = await lookupCompanyById(ico, country);
    setLooking(false);
    if (!result.ok) return;
    setSchoolName(result.data.name);
    setAddress([result.data.street, [result.data.postalCode, result.data.city].filter(Boolean).join(' ')].filter(Boolean).join(', '));
  }

  function submit(form: FormData) {
    setError(null);
    const expected = Number(form.get('expectedStudents'));
    start(async () => {
      const result = await applyAsTeacher({
        country,
        ico: ico.replace(/\s+/g, ''),
        schoolName: schoolName.trim(),
        level: String(form.get('level')),
        address: address.trim() || undefined,
        webUrl: String(form.get('webUrl') ?? '').trim() || undefined,
        name: String(form.get('name') ?? '').trim(),
        subject: String(form.get('subject') ?? '').trim() || undefined,
        expectedStudents: Number.isInteger(expected) && expected > 0 ? expected : undefined,
        acceptTerms: true
      });
      if (!result.ok) {
        setError(tErr.has(result.error) ? tErr(result.error) : tErr('generic'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <form action={submit} className="mt-6 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-bold">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <label className="block text-sm font-medium">
          {t('country')}
          <select value={country} onChange={(e) => setCountry(e.target.value === 'SK' ? 'SK' : 'CZ')} className={`${inputClass} mt-1`}>
            <option value="CZ">{t('countryCZ')}</option>
            <option value="SK">{t('countrySK')}</option>
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('ico')}
          <span className="mt-1 flex gap-2">
            <input
              value={ico}
              onChange={(e) => setIco(e.target.value)}
              onBlur={() => /^\d{8}$/.test(ico.replace(/\s+/g, '')) && !schoolName && void lookup()}
              inputMode="numeric"
              required
              pattern="\s*\d{6,8}\s*"
              className={inputClass}
            />
            <button type="button" onClick={() => void lookup()} disabled={looking} className={buttonClass.secondary}>
              {t('lookup')}
            </button>
          </span>
        </label>
      </div>
      <label className="block text-sm font-medium">
        {t('schoolName')}
        <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} required maxLength={200} className={`${inputClass} mt-1`} />
      </label>
      <label className="block text-sm font-medium">
        {t('address')}
        <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} className={`${inputClass} mt-1`} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t('level')}
          <select name="level" defaultValue="ss" className={`${inputClass} mt-1`}>
            {SCHOOL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(`levels.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t('webUrl')}
          <input name="webUrl" type="url" maxLength={300} placeholder="https://" className={`${inputClass} mt-1`} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t('name')}
          <input name="name" required maxLength={120} autoComplete="name" className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-medium">
          {t('subject')}
          <input name="subject" maxLength={120} className={`${inputClass} mt-1`} />
        </label>
      </div>
      <label className="block text-sm font-medium sm:w-1/2">
        {t('expectedStudents')}
        <input name="expectedStudents" type="number" min={1} max={2000} className={`${inputClass} mt-1`} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required className="mt-1" />
        <span>
          {t.rich('terms', {
            link: (chunks) => (
              // The school terms are drafted in docs/classroom-dpa-draft.md; until they are published, the general DPA applies.
              <Link href="/legal/dpa" target="_blank" className="font-semibold text-primary hover:underline">
                {chunks}
              </Link>
            )
          })}
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{t('emailHint')}</p>
      {error && <Banner tone="err" title={error} />}
      <button type="submit" disabled={pending} className={buttonClass.primary}>
        {t('submit')}
      </button>
    </form>
  );
}
