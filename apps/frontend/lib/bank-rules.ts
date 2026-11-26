/** Bank rules as `GET /api/v1/bank-reconciliation/rules` returns them (see the backend's bank-rules.ts). */

export const RULE_TEXT_FIELDS = ['counterparty_name', 'counterparty_account', 'message', 'variable_symbol', 'any'] as const;
export const RULE_OPERATORS = ['contains', 'equals', 'regex'] as const;
export const RULE_DIRECTIONS = ['any', 'in', 'out'] as const;
export const RULE_ACTIONS = ['ignore', 'draft_expense', 'draft_invoice', 'import_only'] as const;
export type RuleTextField = (typeof RULE_TEXT_FIELDS)[number];
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

/** Same caps as the backend: at most five text conditions, 200 characters each. */
export const MAX_TEXT_CONDITIONS = 5;
export const RULE_VALUE_MAX = 200;

export interface RuleTextCondition {
  field: RuleTextField;
  operator: RuleOperator;
  value: string;
}

export interface RuleConditions {
  text: RuleTextCondition[];
  /** AND ('all', the default) or OR ('any') between the text conditions. */
  textMatch?: 'all' | 'any';
  direction: RuleDirection;
  currency?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
  /** import_only: comma separated words, see `importWordsOf`. */
  keywords?: string | null;
}

export interface BankRuleBody {
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  action: RuleAction;
  expenseCategory?: string | null;
  contactId?: string | null;
  /** import_only: the PSD2 connection it is for; null means all of them. */
  connectionId?: string | null;
}

export interface BankRule extends BankRuleBody {
  id: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** `POST …/rules/preview`: how many unmatched payments the rule fits now, and the first few. */
export interface RulePreview {
  count: number;
  transactions: {
    id: string;
    transactionDate: string;
    amount: string;
    currency: string;
    counterpartyName: string | null;
    counterpartyAccount: string | null;
    variableSymbol: string | null;
    message: string | null;
  }[];
}

/** Error codes the rule endpoints return; each has a text under `bankRules.errors`. */
export const RULE_ERROR_CODES = [
  'rule_needs_condition',
  'invalid_amount_range',
  'invalid_regex',
  'unsafe_regex',
  'action_needs_outgoing',
  'action_needs_incoming',
  'contact_not_found',
  'bank_rule_not_found',
  'import_rule_needs_words',
  'import_rule_needs_psd2',
  'import_rule_not_applicable',
  'bank_connection_not_found',
  'forbidden'
] as const;

/** Same split as the backend's `filterWords`: commas, semicolons or lines. */
export function keywordList(keywords: string | null | undefined): string[] {
  return (keywords ?? '')
    .split(/[,\n;]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/**
 * The words the enabled import_only rules keep for one connection (its own
 * rules and those for every connection), as the sync pools them. Empty when
 * none applies: the connection then downloads incoming payments only.
 */
export function importWordsOf(
  rules: Pick<BankRule, 'action' | 'enabled' | 'conditions' | 'connectionId'>[],
  connectionId: string
): string[] {
  const words = rules
    .filter((r) => r.enabled && r.action === 'import_only' && (r.connectionId == null || r.connectionId === connectionId))
    .flatMap((r) => keywordList(r.conditions.keywords));
  return [...new Set(words)];
}
