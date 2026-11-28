'use client';

import { useState } from 'react';
import { Download, ExternalLink, Landmark, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { VAT_FORM_VERSIONS, VAT_INFO_CHECKED, VAT_OFFICIAL_URL, czTaxOffice } from '@faktur/cz-compliance';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { Modal } from '@/components/modal';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { schemaProblems } from '@/lib/schema-problems';
import { EPO_URL } from './epo-guide';
import { vatFilingSummary, type VatFilingSummary } from './vat-filing-summary';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';
import { FeatureBadge } from '@/components/plan-lock';
import { planRequiredIn, type FeatureUsage } from '@/lib/usage';
import { useVault } from '@/components/vault/vault-provider';
import { isAmountsSealedRefusal, saveText, sealedVatFiling } from '@/lib/vault/sealed-exports';

const FILES = [
  { key: 'dp3', path: 'dphdp3.xml' },
  { key: 'kh1', path: 'dphkh1.xml' },
  { key: 'shv', path: 'dphshv.xml' }
] as const;

const FILES_SK = [
  { key: 'dph', path: 'sk/dphv25.xml' },
  { key: 'kv', path: 'sk/kvdph.xml' },
  { key: 'sv', path: 'sk/svdph.xml' }
] as const;

type Pending = { key: string; name: string; body: string; warnings: string[]; problems: string[]; summary: VatFilingSummary | null };

const SK_OFFICIAL_URL ='https://www.financnasprava.sk/sk/podnikatelia/dane/dan-z-pridanej-hodnoty';
/** `X-Vat-Warnings` (URI-encoded JSON `[{ code, document }]`) grouped by code. */
function vatWarnings(header: string | null): Map<string, string[]> {
  if (!header) return new Map();
  try {
    return groupWarnings(JSON.parse(decodeURIComponent(header)) as { code: string; document: string }[]);
  } catch {
    // A malformed header must not break the download that already happened.
    return new Map();
  }
}

function groupWarnings(list: { code: string; document: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const w of list) out.set(w.code, [...(out.get(w.code) ?? []), w.document]);
  return out;
}

/**
 * VAT filings as XML: EPO for Czech companies (přiznání, kontrolní hlášení,
 * souhrnné hlášení), eDane for Slovak ones (priznanie, kontrolný výkaz,
 * súhrnný výkaz). Fetched rather than linked so a "nothing to report" or
 * missing-DIČ answer shows as a toast instead of a downloaded error page.
 */
export function VatFilings({
  country = 'CZ',
  identified = false,
  checked = VAT_INFO_CHECKED,
  usage
}: {
  country?: 'CZ' | 'SK';
  /** Czech identifikovaná osoba: monthly přiznání and souhrnné hlášení only, no kontrolní hlášení (§ 101c ZDPH). */
  identified?: boolean;
  checked?: string;
  /** Plus and up; lower plans get one download ever. */
  usage?: FeatureUsage | null;
}) {
  const sk = country === 'SK';
  const files = sk ? FILES_SK : identified ? FILES.filter((f) => f.key !== 'kh1') : FILES;
  const t = useTranslations(sk ? 'settings.exports.vat.sk' : 'settings.exports.vat');
  const common = useTranslations('settings.exports.vat');
  const locale = useLocale();
  const tPlan = useTranslations('planLimits');
  const tLock = useTranslations('recordLock');
  const tSealed = useTranslations('vault.amounts');
  const { key: vaultKey, requestUnlock } = useVault();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [mode, setMode] = useState<'month' | 'quarter'>('month');
  const [year, setYear] = useState(String(prev.getFullYear()));
  const [month, setMonth] = useState(String(prev.getMonth() + 1));
  const [quarter, setQuarter] = useState(String(Math.floor(prev.getMonth() / 3) + 1));
  const [busy, setBusy] = useState<string | null>(null);
  // Kept on screen (not a toast): the person needs the document numbers to go and fix them.
  const [warnings, setWarnings] = useState<string[]>([]);
  // The built file waits here until the person has read the summary and taken responsibility for it.
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const years = Array.from({ length: 6 }, (_, i) => String(now.getFullYear() - i));
  // An identified person's tax period is always the calendar month.
  const monthly = mode === 'month' || identified;
  const query = monthly ? `year=${year}&month=${month}` : `year=${year}&quarter=${quarter}`;
  // The server's file name for the same period (exports.controller.ts).
  const label = monthly ? `${year}-${month.padStart(2, '0')}` : `${year}-Q${quarter}`;

  const periodText = monthly
    ? new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
    : `${common('quarter', { q: quarter })} ${year}`;
  const money = new Intl.NumberFormat(locale, { style: 'currency', currency: sk ? 'EUR' : 'CZK', maximumFractionDigits: 0 });

  const nothingToReport = (key: string) => (identified && key === 'dp3' ? common('identified.nothingToReport') : t('nothingToReport'));

  async function explain(key: string, res: Response) {
    const text = res.status === 403 || res.status === 409 ? await res.text() : '';
    const plan = res.status === 403 ? planRequiredIn(text) : null;
    if (plan) {
      toast({ text: tPlan('planRequired', { plan: tPlan(`plans.${plan}`) }), tone: 'info' });
      return;
    }
    const reason = text.includes('filing_needs_full_view')
      ? tLock('filingNeedsFullView')
      : text.includes('form_blocked')
        ? common('formBlocked')
        : res.status === 404
        ? nothingToReport(key)
        : res.status === 400
          ? t('missingDic')
          : res.status === 503
            ? t('rateUnavailable')
            : common('failed');
    toast({ text: reason, tone: res.status === 404 ? 'info' : 'err' });
  }

  /** Some documents have sealed amounts: the file is built here from what the server knows plus what this key opens. */
  async function downloadSealed(key: string, path: string) {
    const k = vaultKey ?? (await requestUnlock());
    if (!k) {
      toast({ text: tSealed('exportLocked'), tone: 'info' });
      return;
    }
    const filing = path.replace(/\.xml$/, '').replace('/', '-');
    const res = await fetch(`/api/files/exports/vat-inputs?filing=${filing}&${query}`);
    if (!res.ok) return explain(key, res);
    const out = await sealedVatFiling(k, await res.json());
    if (out.missing > 0) {
      toast({ text: tSealed('exportUnreadable', { count: out.missing }), tone: 'err' });
      return;
    }
    if (out.body == null) {
      toast({ text: nothingToReport(key), tone: 'info' });
      return;
    }
    review(key, `${path.replace(/^sk\//, '').replace(/\.xml$/, '')}-${label}.xml`, out.body, groupWarnings(out.warnings), []);
  }

  function warningTexts(grouped: Map<string, string[]>) {
    return [...grouped].map(([code, documents]) =>
      t.has(`warnings.${code}`) ? t(`warnings.${code}`, { documents: documents.join(', ') }) : documents.join(', ')
    );
  }

  function review(key: string, name: string, body: string, grouped: Map<string, string[]>, problems: string[]) {
    setConfirmed(false);
    setPending({ key, name, body, warnings: warningTexts(grouped), problems, summary: sk ? null : vatFilingSummary(body) });
  }

  function save(openEpo: boolean) {
    if (!pending || !confirmed) return;
    saveText(pending.name, pending.body, 'application/xml;charset=utf-8');
    // Opened in the same click as the download, so the browser does not block it.
    if (openEpo) window.open(EPO_URL, '_blank', 'noopener');
    // Kept on the page after the dialog closes: the person needs the document numbers to fix them.
    setWarnings(pending.warnings);
    setPending(null);
  }

  async function download(key: string, path: string) {
    setBusy(key);
    setWarnings([]);
    try {
      const res = await fetch(`/api/files/exports/${path}?${query}`);
      if (await isAmountsSealedRefusal(res)) return await downloadSealed(key, path);
      if (!res.ok) return await explain(key, res);
      const body = await res.text();
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? path;
      // The file can be saved anyway; EPO would reject it until these are fixed.
      review(key, name, body, vatWarnings(res.headers.get('x-vat-warnings')), schemaProblems(res.headers.get('x-schema-problems')));
    } catch {
      toast({ text: common('failed'), tone: 'err' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Landmark className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h2 className="font-bold">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('hint')}</p>
          <FeatureBadge usage={usage} className="mt-2" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        {!identified && (
          <select className={cn(inputClass, 'w-auto')} value={mode} onChange={(e) => setMode(e.target.value as 'month' | 'quarter')}>
            <option value="month">{common('monthly')}</option>
            <option value="quarter">{common('quarterly')}</option>
          </select>
        )}
        <select className={cn(inputClass, 'w-auto')} value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        {mode === 'month' || identified ? (
          <select className={cn(inputClass, 'w-auto')} value={month} onChange={(e) => setMonth(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
              <option key={m} value={m}>
                {new Date(2000, Number(m) - 1, 1).toLocaleDateString(locale, { month: 'long' })}
              </option>
            ))}
          </select>
        ) : (
          <select className={cn(inputClass, 'w-auto')} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {['1', '2', '3', '4'].map((q) => (
              <option key={q} value={q}>
                {common('quarter', { q })}
              </option>
            ))}
          </select>
        )}
      </div>
      {identified && <p className="mt-3 text-sm text-muted-foreground">{common('identified.noControlStatement')}</p>}
      <div className={cn('mt-4 grid gap-3', identified ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
        {files.map(({ key, path }) => (
          <button
            key={key}
            type="button"
            disabled={busy !== null}
            onClick={() => download(key, path)}
            className="flex flex-col rounded-lg border border-border p-4 text-left transition-colors hover:border-primary disabled:opacity-60"
          >
            <span className="font-semibold">{t(`files.${key}.title`)}</span>
            <span className="mt-1 flex-1 text-xs text-muted-foreground">
              {identified && key === 'dp3' ? common('identified.dp3Hint') : t(`files.${key}.hint`)}
            </span>
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
              {busy === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {common('download')}
            </span>
          </button>
        ))}
      </div>
      {warnings.map((text) => (
        <Banner key={text} tone="warn" className="mt-4">
          {text}
        </Banner>
      ))}
      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={common('confirm.title')}
        footer={
          <>
            <button type="button" className={buttonClass.secondary} onClick={() => setPending(null)}>
              {common('confirm.back')}
            </button>
            <button type="button" className={sk ? buttonClass.primary : buttonClass.secondary} disabled={!confirmed} onClick={() => save(false)}>
              <Download className="h-4 w-4" />
              {common('download')}
            </button>
            {!sk && (
              <button type="button" className={buttonClass.primary} disabled={!confirmed} onClick={() => save(true)}>
                <ExternalLink className="h-4 w-4" />
                {common('confirm.downloadAndOpenEpo')}
              </button>
            )}
          </>
        }
      >
        {pending && (
          <div className="space-y-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">{common('confirm.form')}</dt>
              <dd className="font-medium">{t(`files.${pending.key}.title`)}</dd>
              <dt className="text-muted-foreground">{common('confirm.period')}</dt>
              <dd className="font-medium">{periodText}</dd>
              {pending.summary && (
                <>
                  <dt className="text-muted-foreground">{common('confirm.office')}</dt>
                  <dd className="font-medium">{czTaxOffice(pending.summary.office)?.name ?? common('confirm.officeMissing')}</dd>
                </>
              )}
              {pending.summary?.dp3 && (
                <>
                  <dt className="text-muted-foreground">{common('confirm.output')}</dt>
                  <dd className="font-medium tabular-nums">{money.format(pending.summary.dp3.output)}</dd>
                  <dt className="text-muted-foreground">{common('confirm.deduction')}</dt>
                  <dd className="font-medium tabular-nums">{money.format(pending.summary.dp3.deduction)}</dd>
                  <dt className="text-muted-foreground">{pending.summary.dp3.refund > 0 ? common('confirm.refund') : common('confirm.payable')}</dt>
                  <dd className="font-semibold tabular-nums">{money.format(pending.summary.dp3.refund > 0 ? pending.summary.dp3.refund : pending.summary.dp3.payable)}</dd>
                </>
              )}
              {pending.summary?.khRows != null && (
                <>
                  <dt className="text-muted-foreground">{common('confirm.khRows')}</dt>
                  <dd className="font-medium tabular-nums">{pending.summary.khRows}</dd>
                </>
              )}
              {pending.summary?.shv && (
                <>
                  <dt className="text-muted-foreground">{common('confirm.shvRows')}</dt>
                  <dd className="font-medium tabular-nums">{pending.summary.shv.rows}</dd>
                  <dt className="text-muted-foreground">{common('confirm.shvTotal')}</dt>
                  <dd className="font-medium tabular-nums">{money.format(pending.summary.shv.total)}</dd>
                </>
              )}
            </dl>
            {pending.problems.length > 0 && (
              <Banner tone="err">{common('confirm.schemaProblems', { problems: pending.problems.join(', ') })}</Banner>
            )}
            {pending.warnings.map((text) => (
              <Banner key={text} tone="warn">
                {text}
              </Banner>
            ))}
            {!sk && (
              <div>
                <p className="font-semibold">{common('confirm.epoTitle')}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                  {(common.raw('confirm.epoSteps') as string[]).map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
            <label className="flex items-start gap-2 rounded-lg border border-border p-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span>{common('confirm.responsibility')}</span>
            </label>
          </div>
        )}
      </Modal>
      <p className="mt-4 text-xs text-muted-foreground">{t('disclaimer')}</p>
      {sk ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('formVersions')}{' '}
          <a href={SK_OFFICIAL_URL} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
            {t('officialLink')}
          </a>
        </p>
      ) : (
        /* Same constants the XML export (verzePis) and the public guide use. */
        <p className="mt-2 text-xs text-muted-foreground">
          {t('formVersions', {
            dp3: VAT_FORM_VERSIONS.DPHDP3,
            kh1: VAT_FORM_VERSIONS.DPHKH1,
            shv: VAT_FORM_VERSIONS.DPHSHV,
            date: new Date(`${checked}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'Europe/Prague' })
          })}{' '}
          <a href={VAT_OFFICIAL_URL} target="_blank" rel="noopener" className="font-semibold text-primary hover:underline">
            {t('officialLink')}
          </a>
          {' · '}
          <Link href="/guides/vat-return-control-statement" locale={locale === 'en' ? 'en' : 'cs'} className="font-semibold text-primary hover:underline">
            {t('guideLink')}
          </Link>
        </p>
      )}
    </section>
  );
}
