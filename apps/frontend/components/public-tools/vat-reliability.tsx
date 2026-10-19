'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert } from 'lucide-react';
import { buttonClass } from '@/lib/ui-classes';
import { ResultRow, TextField } from '@/components/public-tools/fields';
import { cn } from '@/lib/utils';

/** `GET /api/public/company-lookup/vat-check?dic&account` (backend `PublicVatCheck`). */
interface VatCheck {
  vatId: string;
  state: 'payer' | 'unreliable' | 'not_registered' | 'valid' | 'invalid' | 'unknown';
  source: 'ADIS' | 'VIES' | null;
  name: string | null;
  accounts: { published: number; match: boolean | null } | null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; code: 'invalid' | 'busy' | 'unavailable' }
  | { kind: 'done'; check: VatCheck; account: string };

/** A Czech DIČ (CZ + IČO or birth number) or a bare IČO, as "CZ…"; null when it is neither. */
export function czechVatId(raw: string): string | null {
  const compact = raw.replace(/[\s.-]/g, '').toUpperCase();
  const m = /^(CZ)?(\d{8,10})$/.exec(compact);
  return m ? `CZ${m[2]}` : null;
}

/**
 * Unreliable VAT payer check in the CZ register of VAT payers (ADIS), with an
 * optional bank account checked against the accounts the payer published.
 * Goes through the same rate-limited public proxy as the company lookup; a
 * register that does not answer is said so, never shown as "fine".
 */
export function VatReliability() {
  const t = useTranslations('tools.calculators.items.vatReliability');
  const [id, setId] = useState('');
  const [account, setAccount] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const dic = czechVatId(id);
    if (!dic) return setState({ kind: 'error', code: 'invalid' });
    setState({ kind: 'loading' });
    const asked = account.trim();
    const query = new URLSearchParams({ dic });
    if (asked) query.set('account', asked);
    try {
      const res = await fetch(`/api/public/company-lookup/vat-check?${query}`);
      if (res.status === 429) return setState({ kind: 'error', code: 'busy' });
      const body = res.ok ? ((await res.json()) as VatCheck | null) : null;
      if (!body || body.state === 'unknown') return setState({ kind: 'error', code: 'unavailable' });
      setState({ kind: 'done', check: body, account: asked });
    } catch {
      setState({ kind: 'error', code: 'unavailable' });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={check} noValidate>
        <TextField label={t('fields.id')} value={id} onChange={setId} hint={t('fields.idHint')} placeholder="CZ12345678" maxLength={20} />
        <TextField
          label={t('fields.account')}
          value={account}
          onChange={setAccount}
          hint={t('fields.accountHint')}
          placeholder="123456789/0800"
          maxLength={60}
        />
        <button type="submit" className={cn(buttonClass.primary, 'w-full sm:w-auto')} disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? t('fields.checking') : t('fields.check')}
        </button>
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        {state.kind === 'idle' && <p className="text-sm text-muted-foreground">{t('result.empty')}</p>}
        {state.kind === 'loading' && <p className="text-sm text-muted-foreground">{t('fields.checking')}</p>}
        {state.kind === 'error' && (
          <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p>{t(`errors.${state.code}`)}</p>
          </div>
        )}
        {state.kind === 'done' && <Result check={state.check} account={state.account} />}
      </section>
    </div>
  );
}

function Result({ check, account }: { check: VatCheck; account: string }) {
  const t = useTranslations('tools.calculators.items.vatReliability');
  const bad = check.state === 'unreliable';
  const ok = check.state === 'payer';
  const Icon = bad ? ShieldAlert : ok ? CheckCircle2 : CircleHelp;
  const match = check.accounts?.match ?? null;
  return (
    <div className="space-y-4 text-sm">
      <div
        className={cn(
          'flex gap-3 rounded-lg border p-3',
          bad ? 'border-destructive/40 bg-destructive/10' : ok ? 'border-success/40 bg-success/10' : 'border-border bg-secondary'
        )}
      >
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', bad ? 'text-destructive' : ok ? 'text-success' : 'text-muted-foreground')} aria-hidden="true" />
        <div>
          <p className="text-base font-semibold">{t(`result.state.${check.state}`)}</p>
          <p className="mt-1 text-muted-foreground">{t(`result.stateNote.${check.state}`)}</p>
        </div>
      </div>
      <dl>
        {check.name && <ResultRow label={t('result.name')} value={check.name} />}
        <ResultRow label={t('result.vatId')} value={check.vatId} />
        {check.accounts && <ResultRow label={t('result.published')} value={t('result.publishedCount', { n: check.accounts.published })} />}
      </dl>
      {account && check.accounts && (
        <div
          className={cn(
            'rounded-lg border p-3',
            match === true ? 'border-success/40 bg-success/10' : match === false ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-secondary'
          )}
        >
          <p className="font-semibold">{t(match === true ? 'result.accountYes' : match === false ? 'result.accountNo' : 'result.accountInvalid', { account })}</p>
          {match === false && <p className="mt-1 text-muted-foreground">{t('result.accountNoNote')}</p>}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('result.source')}</p>
    </div>
  );
}
