'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ListFilter, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useCanWrite } from '@/components/access-provider';
import { EmptyState } from '@/components/empty-state';
import { ConfirmModal, Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { formatDate, formatMoney } from '@/lib/invoice-ui';
import { EXPENSE_CATEGORIES } from '@/lib/expense-ui';
import {
  MAX_TEXT_CONDITIONS,
  RULE_ACTIONS,
  RULE_DIRECTIONS,
  RULE_ERROR_CODES,
  RULE_TEXT_FIELDS,
  RULE_VALUE_MAX,
  keywordList,
  type BankRule,
  type BankRuleBody,
  type RuleAction,
  type RuleDirection,
  type RuleOperator,
  type RulePreview,
  type RuleTextCondition
} from '@/lib/bank-rules';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';
import { applyBankRule, createBankRule, deleteBankRule, previewBankRule, previewSavedBankRule, reorderBankRules, updateBankRule } from './actions';

/** A rule started from one payment in the bank list's row menu. */
export interface RulePrefill {
  name?: string;
  account?: string;
  direction: RuleDirection;
  /** An "only download" rule for this PSD2 connection ('' = all of them), from the connection's edit form. */
  importFor?: string;
}

type Contact = { id: string; name: string };
type Connection = { id: string; name: string };

/** The form keeps amounts as typed; they become numbers (or null) on save. */
interface Draft {
  name: string;
  enabled: boolean;
  text: RuleTextCondition[];
  textMatch: 'all' | 'any';
  direction: RuleDirection;
  currency: string;
  minAmount: string;
  maxAmount: string;
  action: RuleAction;
  expenseCategory: string;
  contactId: string;
  keywords: string;
  /** import_only: '' = every PSD2 connection. */
  connectionId: string;
}

const emptyDraft = (): Draft => ({
  name: '',
  enabled: true,
  text: [{ field: 'counterparty_name', operator: 'contains', value: '' }],
  textMatch: 'all',
  direction: 'any',
  currency: '',
  minAmount: '',
  maxAmount: '',
  action: 'ignore',
  expenseCategory: '',
  contactId: '',
  keywords: '',
  connectionId: ''
});

function draftOf(rule: BankRule): Draft {
  return {
    name: rule.name,
    enabled: rule.enabled,
    text: rule.conditions.text.length ? rule.conditions.text : emptyDraft().text,
    textMatch: rule.conditions.textMatch ?? 'all',
    direction: rule.conditions.direction,
    currency: rule.conditions.currency ?? '',
    minAmount: rule.conditions.minAmount != null ? String(rule.conditions.minAmount) : '',
    maxAmount: rule.conditions.maxAmount != null ? String(rule.conditions.maxAmount) : '',
    action: rule.action,
    expenseCategory: rule.expenseCategory ?? '',
    contactId: rule.contactId ?? '',
    keywords: rule.conditions.keywords ?? '',
    connectionId: rule.connectionId ?? ''
  };
}

function draftFromPrefill(prefill: RulePrefill): Draft {
  if (prefill.importFor !== undefined) return { ...emptyDraft(), action: 'import_only', connectionId: prefill.importFor };
  // A PayPal payer is best told apart by the e-mail; a bank payment by the name.
  const byAccount = Boolean(prefill.account && (prefill.account.includes('@') || !prefill.name));
  const value = (byAccount ? prefill.account : prefill.name) ?? '';
  return {
    ...emptyDraft(),
    name: value.slice(0, 100),
    text: [{ field: byAccount ? 'counterparty_account' : 'counterparty_name', operator: 'contains', value }],
    direction: prefill.direction
  };
}

const amount = (v: string) => {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  // The rule compares amounts without the sign, so "-500" means 500.
  return v.trim() && Number.isFinite(n) ? Math.abs(n) : null;
};

function bodyOf(d: Draft): BankRuleBody {
  if (d.action === 'import_only') {
    // Only the words count; the backend drops the other conditions too.
    return {
      name: d.name.trim() || keywordList(d.keywords).join(', ').slice(0, 100) || '–',
      enabled: d.enabled,
      conditions: { text: [], direction: 'any', keywords: d.keywords.trim() },
      action: d.action,
      connectionId: d.connectionId || null
    };
  }
  return {
    name: d.name.trim() || d.text.find((c) => c.value.trim())?.value.trim().slice(0, 100) || '–',
    enabled: d.enabled,
    conditions: {
      text: d.text.filter((c) => c.value.trim()).map((c) => ({ ...c, value: c.value.trim() })),
      textMatch: d.textMatch,
      direction: d.direction,
      // A half-typed currency would fail validation; it only counts once it has three letters.
      currency: d.currency.length === 3 ? d.currency : null,
      minAmount: amount(d.minAmount),
      maxAmount: amount(d.maxAmount)
    },
    action: d.action,
    expenseCategory: d.action === 'draft_expense' ? d.expenseCategory || null : null,
    contactId: d.action === 'draft_invoice' ? d.contactId || null : null,
    connectionId: null
  };
}

/** Worth asking the backend about: at least one text or amount condition. */
const hasCondition = (b: BankRuleBody) =>
  b.action === 'import_only'
    ? keywordList(b.conditions.keywords).length > 0
    : b.conditions.text.length > 0 || b.conditions.minAmount != null || b.conditions.maxAmount != null;

/** Drafts only make sense one way: expenses from outgoing payments, invoices from incoming ones. */
const forcedDirection = (action: RuleAction): RuleDirection | null =>
  action === 'draft_expense' ? 'out' : action === 'draft_invoice' ? 'in' : null;

export function RulesManager({
  rules,
  contacts,
  connections,
  canManageImport,
  prefill
}: {
  rules: BankRule[];
  contacts: Contact[];
  /** PSD2 connections, the only ones an "only download" rule filters. */
  connections: Connection[];
  /** Owner/admin: what an account downloads was their setting on the connection, and stays theirs. */
  canManageImport: boolean;
  prefill: RulePrefill | null;
}) {
  const t = useTranslations('bankRules');
  const router = useRouter();
  const canEdit = useCanWrite('bank');
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ rule: BankRule | null; draft: Draft } | null>(
    prefill ? { rule: null, draft: draftFromPrefill(prefill) } : null
  );
  const [deleting, setDeleting] = useState<BankRule | null>(null);
  const [applying, setApplying] = useState<{ rule: BankRule; count: number | null } | null>(null);

  // The prefill lives in the URL; drop it so a reload does not open the form again.
  useEffect(() => {
    if (prefill) router.replace('/bank/rules');
  }, [prefill, router]);

  const errorText = (code: string) => ((RULE_ERROR_CODES as readonly string[]).includes(code) ? t(`errors.${code}`) : `${t('errors.generic')}: ${code}`);

  const contactName = (id: string | null | undefined) => contacts.find((c) => c.id === id)?.name ?? null;
  const connectionName = (id: string | null | undefined) =>
    id ? (connections.find((c) => c.id === id)?.name ?? t('importOnly.removedAccount')) : t('importOnly.allAccounts');
  const mayChange = (rule: BankRule) => rule.action !== 'import_only' || canManageImport;

  const move = (index: number, by: -1 | 1) => {
    const ids = rules.map((r) => r.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    startTransition(async () => {
      const result = await reorderBankRules(ids);
      if (!result.ok) toast({ text: errorText(result.error), tone: 'err' });
      router.refresh();
    });
  };

  const toggle = (rule: BankRule) =>
    startTransition(async () => {
      const result = await updateBankRule(rule.id, { enabled: !rule.enabled });
      toast(result.ok ? { text: rule.enabled ? t('list.disabledDone') : t('list.enabledDone'), tone: 'ok' } : { text: errorText(result.error), tone: 'err' });
      router.refresh();
    });

  const remove = () => {
    if (!deleting) return;
    const rule = deleting;
    startTransition(async () => {
      const result = await deleteBankRule(rule.id);
      setDeleting(null);
      toast(result.ok ? { text: t('delete.done'), tone: 'ok' } : { text: errorText(result.error), tone: 'err' });
      router.refresh();
    });
  };

  const askApply = (rule: BankRule) => {
    setApplying({ rule, count: null });
    void previewSavedBankRule(rule.id).then((result) =>
      setApplying((current) => (current?.rule.id === rule.id ? { rule, count: result.ok ? result.data.count : null } : current))
    );
  };

  const apply = () => {
    if (!applying) return;
    const { rule } = applying;
    startTransition(async () => {
      const result = await applyBankRule(rule.id);
      setApplying(null);
      if (!result.ok) {
        toast({ text: errorText(result.error), tone: 'err' });
        return;
      }
      const { applied, remaining } = result.data;
      toast({
        text: applied === 0 ? t('apply.nothing') : remaining > 0 ? t('apply.doneMore', { applied, remaining }) : t('apply.done', { applied }),
        tone: 'ok'
      });
      router.refresh();
    });
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {canEdit && (
          <button type="button" className={buttonClass.primary} onClick={() => setEditing({ rule: null, draft: emptyDraft() })}>
            <Plus className="h-4 w-4" />
            {t('newRule')}
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={ListFilter}
          title={t('empty')}
          hint={t('emptyHint')}
          action={
            canEdit && (
              <button type="button" className={buttonClass.primary} onClick={() => setEditing({ rule: null, draft: emptyDraft() })}>
                <Plus className="h-4 w-4" />
                {t('newRule')}
              </button>
            )
          }
        />
      ) : (
        <>
          <p className="mt-6 text-xs text-muted-foreground">{t('list.order')}</p>
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {rules.map((rule, index) => (
              <li key={rule.id} className={cn('flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4', !rule.enabled && 'opacity-60')}>
                {canEdit && mayChange(rule) ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.enabled}
                    aria-label={t('list.enabled')}
                    disabled={pending}
                    onClick={() => toggle(rule)}
                    className={cn(
                      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
                      rule.enabled ? 'bg-primary' : 'bg-border'
                    )}
                  >
                    <span
                      className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5')}
                    />
                  </button>
                ) : (
                  !rule.enabled && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t('list.off')}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">{index + 1}.</span>
                    {rule.name}
                  </p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <RuleSummary rule={rule} connectionName={connectionName} />
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-primary">
                    {t(`action.${rule.action}`)}
                    {rule.action === 'draft_invoice' && contactName(rule.contactId) && ` · ${contactName(rule.contactId)}`}
                  </p>
                </div>
                {canEdit && mayChange(rule) && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton label={t('list.moveUp')} disabled={pending || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </IconButton>
                    <IconButton label={t('list.moveDown')} disabled={pending || index === rules.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </IconButton>
                    {rule.action !== 'import_only' && (
                      <IconButton label={t('apply.button')} disabled={pending || !rule.enabled} onClick={() => askApply(rule)}>
                        <Play className="h-4 w-4" />
                      </IconButton>
                    )}
                    <IconButton label={t('list.edit')} disabled={pending} onClick={() => setEditing({ rule, draft: draftOf(rule) })}>
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton label={t('list.delete')} disabled={pending} onClick={() => setDeleting(rule)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <RuleForm
          key={editing.rule?.id ?? 'new'}
          rule={editing.rule}
          initial={editing.draft}
          contacts={contacts}
          connections={connections}
          canManageImport={canManageImport}
          errorText={errorText}
          onClose={() => setEditing(null)}
          onApply={(rule) => (setEditing(null), askApply(rule))}
        />
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title={t('delete.title')}
        body={t('delete.body', { name: deleting?.name ?? '' })}
        confirmLabel={t('delete.confirm')}
        backLabel={t('form.cancel')}
        pending={pending}
        danger
        icon={<Trash2 className="h-4 w-4" />}
      />

      <ConfirmModal
        open={Boolean(applying)}
        onClose={() => setApplying(null)}
        onConfirm={apply}
        title={t('apply.confirmTitle', { name: applying?.rule.name ?? '' })}
        body={
          <>
            {applying?.count == null ? t('preview.loading') : t('preview.count', { count: applying.count })} {t(`apply.what.${applying?.rule.action ?? 'ignore'}`)}{' '}
            {t('apply.rematchFirst')}
          </>
        }
        confirmLabel={t('apply.button')}
        backLabel={t('form.cancel')}
        pending={pending || applying?.count === 0}
        icon={<Play className="h-4 w-4" />}
      />
    </>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-primary disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/** "Protistrana obsahuje „Vodafone“ · odchozí · 100–2 000" */
function RuleSummary({
  rule,
  connectionName
}: {
  rule: Pick<BankRule, 'conditions' | 'action' | 'connectionId'>;
  connectionName: (id: string | null | undefined) => string;
}) {
  const t = useTranslations('bankRules');
  const c = rule.conditions;
  if (rule.action === 'import_only') {
    return <>{t('importOnly.summary', { account: connectionName(rule.connectionId), words: keywordList(c.keywords).join(', ') })}</>;
  }
  const texts = c.text.map((cond) => `${t(`field.${cond.field}`)} ${t(`operator.${cond.operator}`)} „${cond.value}“`);
  const parts = texts.length ? [texts.join(c.textMatch === 'any' ? t('summary.or') : t('summary.and'))] : [];
  if (c.direction !== 'any') parts.push(t(`direction.${c.direction}`));
  if (c.currency) parts.push(c.currency);
  if (c.minAmount != null && c.maxAmount != null) parts.push(t('summary.between', { min: c.minAmount, max: c.maxAmount }));
  else if (c.minAmount != null) parts.push(t('summary.atLeast', { min: c.minAmount }));
  else if (c.maxAmount != null) parts.push(t('summary.atMost', { max: c.maxAmount }));
  return <>{parts.join(' · ')}</>;
}

function RuleForm({
  rule,
  initial,
  contacts,
  connections,
  canManageImport,
  errorText,
  onClose,
  onApply
}: {
  rule: BankRule | null;
  initial: Draft;
  contacts: Contact[];
  connections: Connection[];
  canManageImport: boolean;
  errorText: (code: string) => string;
  onClose: () => void;
  onApply: (rule: BankRule) => void;
}) {
  const t = useTranslations('bankRules');
  const tCat = useTranslations('expenses.category');
  const locale = useLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [advanced, setAdvanced] = useState(initial.text.some((c) => c.operator === 'regex'));
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ state: 'idle' | 'loading' } | { state: 'done'; data: RulePreview } | { state: 'error'; code: string }>({
    state: 'idle'
  });
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const body = useMemo(() => bodyOf(draft), [draft]);
  const bodyKey = JSON.stringify({ ...body, name: '', enabled: true });
  const isImport = draft.action === 'import_only';
  // An "only download" rule acts on the next sync, never on stored payments: nothing to preview or apply.
  const ready = hasCondition(body) && !isImport;

  // Live preview: 400 ms after the last change, only the newest answer counts.
  useEffect(() => {
    if (!ready) {
      setPreview({ state: 'idle' });
      return;
    }
    setPreview({ state: 'loading' });
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const result = await previewBankRule(body);
      if (mine !== seq.current) return;
      setPreview(result.ok ? { state: 'done', data: result.data } : { state: 'error', code: result.error });
    }, 400);
    return () => clearTimeout(timer);
    // `bodyKey` stands for `body`; the name and the switch do not change what matches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, ready]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setCondition = (index: number, patch: Partial<RuleTextCondition>) =>
    setDraft((d) => ({ ...d, text: d.text.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  const setAction = (action: RuleAction) => setDraft((d) => ({ ...d, action, direction: forcedDirection(action) ?? d.direction }));
  const forced = forcedDirection(draft.action);

  const save = (thenApply: boolean) => {
    setError(null);
    if (!hasCondition(body)) {
      setError(errorText(isImport ? 'import_rule_needs_words' : 'rule_needs_condition'));
      return;
    }
    startTransition(async () => {
      const result = rule ? await updateBankRule(rule.id, body) : await createBankRule(body);
      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }
      toast({ text: rule ? t('form.saved') : t('form.created'), tone: 'ok' });
      router.refresh();
      if (thenApply) onApply(result.data);
      else onClose();
    });
  };

  const operators: RuleOperator[] = advanced ? ['contains', 'equals', 'regex'] : ['contains', 'equals'];
  const actions = RULE_ACTIONS.filter((a) => a !== 'import_only' || canManageImport);
  const label = 'mb-1 block text-xs font-semibold text-muted-foreground';

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? t('form.titleEdit') : t('form.titleNew')}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            {t('form.cancel')}
          </button>
          {!isImport && (
            <button type="button" className={buttonClass.secondary} disabled={pending || !draft.enabled} onClick={() => save(true)}>
              <Play className="h-4 w-4" />
              {t('form.saveAndApply')}
            </button>
          )}
          <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => save(false)}>
            {t('form.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="rule-name">
            {t('form.name')}
          </label>
          <input
            id="rule-name"
            className={inputClass}
            value={draft.name}
            maxLength={100}
            placeholder={t('form.namePlaceholder')}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>

        {isImport ? (
          <div className="space-y-3">
            <div>
              <label className={label} htmlFor="rule-connection">
                {t('importOnly.account')}
              </label>
              <select id="rule-connection" className={inputClass} value={draft.connectionId} onChange={(e) => set('connectionId', e.target.value)}>
                <option value="">{t('importOnly.allAccounts')}</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {draft.connectionId && !connections.some((c) => c.id === draft.connectionId) && (
                  <option value={draft.connectionId}>{t('importOnly.removedAccount')}</option>
                )}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="rule-keywords">
                {t('importOnly.keywords')}
              </label>
              <input
                id="rule-keywords"
                className={inputClass}
                value={draft.keywords}
                maxLength={500}
                placeholder={t('importOnly.keywordsPlaceholder')}
                onChange={(e) => set('keywords', e.target.value)}
              />
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t('importOnly.hint')}</p>
            </div>
          </div>
        ) : (
          <>
        <fieldset>
          <legend className={label}>{t('form.conditions')}</legend>
          <p className="mb-2 text-xs text-muted-foreground">{t('form.conditionsHint')}</p>
          {draft.text.length > 1 && (
            <select
              aria-label={t('form.textMatch')}
              className={cn(inputClass, 'mb-2 w-auto')}
              value={draft.textMatch}
              onChange={(e) => setDraft((d) => ({ ...d, textMatch: e.target.value as Draft['textMatch'] }))}
            >
              <option value="all">{t('form.textMatchAll')}</option>
              <option value="any">{t('form.textMatchAny')}</option>
            </select>
          )}
          <div className="space-y-2">
            {draft.text.map((cond, index) => (
              <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[10rem_9rem_1fr_auto]">
                <select
                  aria-label={t('form.field')}
                  className={inputClass}
                  value={cond.field}
                  onChange={(e) => setCondition(index, { field: e.target.value as RuleTextCondition['field'] })}
                >
                  {RULE_TEXT_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {t(`field.${f}`)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('form.operator')}
                  className={inputClass}
                  value={cond.operator}
                  onChange={(e) => setCondition(index, { operator: e.target.value as RuleOperator })}
                >
                  {operators.map((o) => (
                    <option key={o} value={o}>
                      {t(`operator.${o}`)}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('form.value')}
                  className={cn(inputClass, 'col-span-2 sm:col-span-1', cond.operator === 'regex' && 'font-mono')}
                  value={cond.value}
                  maxLength={RULE_VALUE_MAX}
                  placeholder={cond.operator === 'regex' ? '^VODAFONE' : t('form.valuePlaceholder')}
                  onChange={(e) => setCondition(index, { value: e.target.value })}
                />
                {draft.text.length > 1 && (
                  <button
                    type="button"
                    aria-label={t('form.removeCondition')}
                    title={t('form.removeCondition')}
                    className="col-span-2 inline-flex h-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive sm:col-span-1 sm:w-9"
                    onClick={() => set('text', draft.text.filter((_, i) => i !== index))}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {draft.text.length < MAX_TEXT_CONDITIONS && (
              <button
                type="button"
                className={buttonClass.ghost}
                onClick={() => set('text', [...draft.text, { field: 'any', operator: 'contains', value: '' }])}
              >
                <Plus className="h-4 w-4" />
                {t('form.addCondition')}
              </button>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={advanced}
                onChange={(e) => {
                  setAdvanced(e.target.checked);
                  // Leaving advanced mode turns regex conditions back into plain "contains".
                  if (!e.target.checked) set('text', draft.text.map((c) => (c.operator === 'regex' ? { ...c, operator: 'contains' } : c)));
                }}
              />
              {t('form.advanced')}
            </label>
          </div>
          {advanced && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{t('form.regexHint')}</p>}
        </fieldset>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <label className={label} htmlFor="rule-direction">
              {t('form.direction')}
            </label>
            <select
              id="rule-direction"
              className={inputClass}
              value={draft.direction}
              disabled={Boolean(forced)}
              onChange={(e) => set('direction', e.target.value as RuleDirection)}
            >
              {RULE_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`direction.${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className={label} htmlFor="rule-currency">
              {t('form.currency')}
            </label>
            <input
              id="rule-currency"
              className={cn(inputClass, 'uppercase')}
              value={draft.currency}
              maxLength={3}
              placeholder={t('form.currencyAny')}
              onChange={(e) => set('currency', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
            />
          </div>
          <div>
            <label className={label} htmlFor="rule-min">
              {t('form.minAmount')}
            </label>
            <input id="rule-min" inputMode="decimal" className={inputClass} value={draft.minAmount} onChange={(e) => set('minAmount', e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="rule-max">
              {t('form.maxAmount')}
            </label>
            <input id="rule-max" inputMode="decimal" className={inputClass} value={draft.maxAmount} onChange={(e) => set('maxAmount', e.target.value)} />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">{t('form.amountHint')}</p>
          </>
        )}

        <fieldset>
          <legend className={label}>{t('form.action')}</legend>
          <div className="space-y-1.5">
            {actions.map((a) => (
              <label
                key={a}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2',
                  draft.action === a ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/60'
                )}
              >
                <input type="radio" name="rule-action" className="mt-0.5 h-4 w-4 accent-primary" checked={draft.action === a} onChange={() => setAction(a)} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t(`action.${a}`)}</span>
                  <span className="block text-xs text-muted-foreground">{t(`actionHint.${a}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {draft.action === 'draft_expense' && (
          <div>
            <label className={label} htmlFor="rule-category">
              {t('form.category')}
            </label>
            <select id="rule-category" className={inputClass} value={draft.expenseCategory} onChange={(e) => set('expenseCategory', e.target.value)}>
              <option value="">{t('form.categoryNone')}</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tCat(c)}
                </option>
              ))}
            </select>
          </div>
        )}
        {draft.action === 'draft_invoice' && (
          <div>
            <label className={label} htmlFor="rule-contact">
              {t('form.contact')}
            </label>
            <select id="rule-contact" className={inputClass} value={draft.contactId} onChange={(e) => set('contactId', e.target.value)}>
              <option value="">{t('form.contactNone')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {t('form.enabled')}
        </label>

        {!isImport && (
        <section className="rounded-xl border border-border bg-muted/40 p-3" aria-live="polite">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('preview.title')}</h3>
          {preview.state === 'idle' && <p className="mt-1.5 text-sm text-muted-foreground">{t('preview.incomplete')}</p>}
          {preview.state === 'loading' && <p className="mt-1.5 text-sm text-muted-foreground">{t('preview.loading')}</p>}
          {preview.state === 'error' && <p className="mt-1.5 text-sm font-semibold text-destructive">{errorText(preview.code)}</p>}
          {preview.state === 'done' && (
            <>
              <p className="mt-1.5 text-sm font-semibold">{t('preview.count', { count: preview.data.count })}</p>
              {preview.data.transactions.length > 0 && (
                <ul className="mt-2 divide-y divide-border text-xs">
                  {preview.data.transactions.slice(0, 5).map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate">
                        <span className="tabular-nums text-muted-foreground">{formatDate(tx.transactionDate, locale)}</span>{' '}
                        {tx.counterpartyName ?? tx.counterpartyAccount ?? '–'}
                      </span>
                      <span className={cn('shrink-0 font-semibold tabular-nums', Number(tx.amount) < 0 ? 'text-destructive' : 'text-success')}>
                        <span className="amount">{formatMoney(Number(tx.amount), tx.currency, locale)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.data.count > 5 && <p className="mt-1 text-xs text-muted-foreground">{t('preview.more', { count: preview.data.count - 5 })}</p>}
              <p className="mt-2 text-xs text-muted-foreground">{t('preview.onlyUnmatched')}</p>
            </>
          )}
        </section>
        )}

        {error && <p className="text-sm font-semibold text-destructive">{error}</p>}
      </div>
    </Modal>
  );
}
