/** Bank rules as `GET /api/v1/bank-reconciliation/rules` returns them (see the backend's bank-rules.ts). */

export const RULE_TEXT_FIELDS = ['counterparty_name', 'counterparty_account', 'message', 'variable_symbol', 'any'] as const;
export const RULE_OPERATORS = ['contains', 'equals', 'regex'] as const;
export const RULE_DIRECTIONS = ['any', 'in', 'out'] as const;
export const RULE_ACTIONS = ['ignore', 'draft_expense', 'draft_invoice'] as const;
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
  direction: RuleDirection;
  currency?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
}

export interface BankRuleBody {
  name: string;
  enabled: boolean;
  conditions: RuleConditions;
  action: RuleAction;
  expenseCategory?: string | null;
  contactId?: string | null;
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
  'forbidden'
] as const;
