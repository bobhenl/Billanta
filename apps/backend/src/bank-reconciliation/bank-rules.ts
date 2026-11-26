import { normalizeVariableSymbol } from "@faktur/cz-compliance";
import { z } from "zod";
import { filterWords, passesImportFilter } from "./import-filter";
import type { ParsedBankTransactionRow } from "./csv-parser";

/**
 * Bank rules ("Pravidla pro platby"): what to do with a payment no invoice
 * matched. Pure logic only: the schemas, validation with stable error codes,
 * and the matcher. The service runs the actions.
 *
 * `import_only` is the odd one out: it never acts on a stored payment. It
 * runs during a PSD2 sync, before anything is stored, and keeps only the
 * movements that contain one of its `keywords` (see `importWordsFor`).
 */

export const RULE_TEXT_FIELDS = ["counterparty_name", "counterparty_account", "message", "variable_symbol", "any"] as const;
export const RULE_OPERATORS = ["contains", "equals", "regex"] as const;
export const RULE_DIRECTIONS = ["any", "in", "out"] as const;
export const RULE_ACTIONS = ["ignore", "draft_expense", "draft_invoice", "import_only"] as const;
export type RuleTextField = (typeof RULE_TEXT_FIELDS)[number];
export type RuleOperator = (typeof RULE_OPERATORS)[number];
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const REGEX_MAX_LENGTH = 200;
/** Regexes only see this much of each field; see `checkRegex`. */
export const REGEX_SUBJECT_MAX = 200;
const MAX_UNBOUNDED_QUANTIFIERS = 2;

export const textConditionSchema = z.object({
  field: z.enum(RULE_TEXT_FIELDS),
  operator: z.enum(RULE_OPERATORS).default("contains"),
  value: z.string().trim().min(1).max(REGEX_MAX_LENGTH),
});

export const ruleConditionsSchema = z.object({
  text: z.array(textConditionSchema).max(5).default([]),
  /** "all": every text condition holds (AND); "any": at least one does (OR). Direction, currency and amount always have to hold. */
  textMatch: z.enum(["all", "any"]).optional(),
  direction: z.enum(RULE_DIRECTIONS).default("any"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .nullish(),
  minAmount: z.coerce.number().nonnegative().max(1e12).nullish(),
  maxAmount: z.coerce.number().nonnegative().max(1e12).nullish(),
  /** import_only: the words, comma, semicolon or line separated, matched like the old connection filter. */
  keywords: z.string().trim().max(500).nullish(),
});
export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export const ruleBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  conditions: ruleConditionsSchema,
  action: z.enum(RULE_ACTIONS),
  expenseCategory: z.string().trim().min(1).max(64).nullish(),
  contactId: z.string().uuid().nullish(),
  /** import_only: the PSD2 connection it is for; null means every PSD2 connection. */
  connectionId: z.string().uuid().nullish(),
});
export type RuleBody = z.infer<typeof ruleBodySchema>;

/** What the matcher needs of a rule (a stored row or an unsaved body). */
export interface RuleLike {
  id?: string;
  enabled?: boolean;
  action: RuleAction | string;
  conditions: RuleConditions;
}

/** What the matcher needs of a stored payment. */
export interface PaymentForRules {
  amount: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  message: string | null;
  variableSymbol: string | null;
}

export type RuleValidationError =
  | "rule_needs_condition"
  | "invalid_amount_range"
  | "invalid_regex"
  | "unsafe_regex"
  | "action_needs_outgoing"
  | "action_needs_incoming"
  | "import_rule_needs_words";

/**
 * Whether a user regex is safe to run on bank text. Node has no regex
 * timeout and RE2 would be a native dependency, so the guard is static:
 * it must compile, stay under `REGEX_MAX_LENGTH`, and avoid the shapes
 * that backtrack exponentially: a repeated group that itself repeats or
 * alternates (`(a+)+`, `(a|aa)*`), backreferences and lookarounds. A
 * regex with no nesting can still backtrack polynomially (`.*.*x`), so at
 * most two unbounded quantifiers are allowed and every field is cut to
 * `REGEX_SUBJECT_MAX` characters. Measured worst case is then about 15 ms
 * per field, which a sync can afford.
 */
export function checkRegex(pattern: string): null | "invalid_regex" | "unsafe_regex" {
  if (pattern.length === 0 || pattern.length > REGEX_MAX_LENGTH) return "invalid_regex";
  try {
    new RegExp(pattern, "iu");
  } catch {
    return "invalid_regex";
  }

  type Frame = { repeats: boolean; alternates: boolean };
  const stack: Frame[] = [{ repeats: false, alternates: false }];
  let unbounded = 0;

  /** Reads a quantifier at `i`: its length and whether it repeats (more than once) / is unbounded. */
  const quantifierAt = (i: number): { len: number; repeats: boolean; unbounded: boolean } | null => {
    const c = pattern[i];
    let len = 0;
    let repeats = false;
    let open = false;
    if (c === "*" || c === "+") {
      len = 1;
      repeats = true;
      open = true;
    } else if (c === "?") {
      len = 1;
    } else if (c === "{") {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (!m) return null;
      len = m[0].length;
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
      repeats = max > 1;
      // A wide bounded range backtracks like an open one.
      open = max === Infinity || max - min > 20;
    } else {
      return null;
    }
    if (pattern[i + len] === "?") len++; // lazy
    return { len, repeats, unbounded: open };
  };

  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    let atomEnd = i + 1;
    let closed: Frame | null = null;
    if (c === "\\") {
      const next = pattern[i + 1];
      if (next && /[1-9]/.test(next)) return "unsafe_regex";
      if (next === "k") return "unsafe_regex";
      atomEnd = i + 2;
      // \p{...} / \u{...}: one atom.
      if ((next === "p" || next === "P" || next === "u") && pattern[i + 2] === "{") {
        const close = pattern.indexOf("}", i + 2);
        atomEnd = close === -1 ? pattern.length : close + 1;
      }
    } else if (c === "[") {
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      atomEnd = j + 1;
    } else if (c === "(") {
      if (/^\(\?(=|!|<=|<!)/.test(pattern.slice(i))) return "unsafe_regex";
      stack.push({ repeats: false, alternates: false });
      i += pattern.startsWith("(?:", i) ? 3 : /^\(\?<[A-Za-z_]\w*>/.test(pattern.slice(i)) ? pattern.indexOf(">", i) + 1 - i : 1;
      continue;
    } else if (c === "|") {
      stack[stack.length - 1].alternates = true;
      i++;
      continue;
    } else if (c === ")") {
      closed = stack.pop() ?? null;
      if (stack.length === 0) return "invalid_regex";
    }

    const q = quantifierAt(atomEnd);
    const top = stack[stack.length - 1];
    if (q) {
      if (q.repeats && closed && (closed.repeats || closed.alternates)) return "unsafe_regex";
      if (q.unbounded && ++unbounded > MAX_UNBOUNDED_QUANTIFIERS) return "unsafe_regex";
      if (q.repeats) top.repeats = true;
      i = atomEnd + q.len;
    } else {
      i = atomEnd;
    }
    if (closed?.repeats) top.repeats = true;
  }
  return null;
}

/** Checks what zod cannot: at least one condition, the amount range, regexes, action vs direction. */
export function validateRule(body: Pick<RuleBody, "action" | "conditions">): RuleValidationError | null {
  const c = body.conditions;
  if (body.action === "import_only") return filterWords(c.keywords).length > 0 ? null : "import_rule_needs_words";
  const hasAmount = c.minAmount != null || c.maxAmount != null;
  if (c.text.length === 0 && !hasAmount) return "rule_needs_condition";
  if (c.minAmount != null && c.maxAmount != null && c.minAmount > c.maxAmount) return "invalid_amount_range";
  for (const t of c.text) {
    if (t.operator === "regex") {
      const problem = checkRegex(t.value);
      if (problem) return problem;
    }
  }
  if (body.action === "draft_expense" && c.direction !== "out") return "action_needs_outgoing";
  if (body.action === "draft_invoice" && c.direction !== "in") return "action_needs_incoming";
  return null;
}

/** Lower case, no diacritics, single spaces: "Fakturoid  s.r.o." ~ "fakturoid s.r.o.". */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function fieldValues(payment: PaymentForRules, field: RuleTextField): string[] {
  const all: Record<Exclude<RuleTextField, "any">, string | null> = {
    counterparty_name: payment.counterpartyName,
    counterparty_account: payment.counterpartyAccount,
    message: payment.message,
    variable_symbol: payment.variableSymbol,
  };
  const picked = field === "any" ? Object.values(all) : [all[field]];
  return picked.filter((v): v is string => Boolean(v && v.trim()));
}

type Predicate = (payment: PaymentForRules) => boolean;

function compileText(cond: RuleConditions["text"][number]): Predicate {
  if (cond.operator === "regex") {
    // Validated on save; a stored pattern that no longer passes never matches.
    if (checkRegex(cond.value)) return () => false;
    const re = new RegExp(cond.value, "iu");
    return (p) => fieldValues(p, cond.field).some((v) => re.test(v.slice(0, REGEX_SUBJECT_MAX)));
  }
  const needle = foldText(cond.value);
  if (cond.operator === "equals") {
    return (p) =>
      fieldValues(p, cond.field).some((v) => {
        if (cond.field === "variable_symbol") return normalizeVariableSymbol(v) === normalizeVariableSymbol(cond.value);
        return foldText(v) === needle;
      });
  }
  return (p) => fieldValues(p, cond.field).some((v) => foldText(v).includes(needle));
}

export interface CompiledRule<R extends RuleLike = RuleLike> {
  rule: R;
  matches: Predicate;
}

/** Turns a rule into one predicate: every given condition has to hold, the text ones as a group (all or any). */
export function compileRule<R extends RuleLike>(rule: R): CompiledRule<R> {
  const c = rule.conditions;
  const checks: Predicate[] = [];
  if (c.direction === "in") checks.push((p) => p.amount > 0);
  if (c.direction === "out") checks.push((p) => p.amount < 0);
  if (rule.action === "draft_expense") checks.push((p) => p.amount < 0);
  if (rule.action === "draft_invoice") checks.push((p) => p.amount > 0);
  if (c.currency) checks.push((p) => p.currency.toUpperCase() === c.currency);
  if (c.minAmount != null) checks.push((p) => Math.abs(p.amount) >= c.minAmount!);
  if (c.maxAmount != null) checks.push((p) => Math.abs(p.amount) <= c.maxAmount!);
  const texts = c.text.map(compileText);
  if (texts.length) checks.push(c.textMatch === "any" ? (p) => texts.some((t) => t(p)) : (p) => texts.every((t) => t(p)));
  // A rule with nothing but a direction would hit every payment; validateRule refuses it, this keeps old rows safe.
  // An import_only rule decides what is stored, so it never acts on a stored payment.
  const empty = rule.action === "import_only" || (c.text.length === 0 && c.minAmount == null && c.maxAmount == null);
  return { rule, matches: (p) => !empty && checks.every((check) => check(p)) };
}

/**
 * The first enabled rule (in the given order) that fits the payment. With
 * `drafts: false` (a history backfill), a fitting draft rule still stops the
 * search: it is the rule the member meant, so no later rule acts instead.
 */
export function firstMatchingRule<R extends RuleLike>(
  rules: CompiledRule<R>[],
  payment: PaymentForRules,
  options: { drafts?: boolean } = {},
): R | null {
  for (const compiled of rules) {
    if (compiled.rule.enabled === false) continue;
    if (!compiled.matches(payment)) continue;
    if (options.drafts === false && compiled.rule.action !== "ignore") return null;
    return compiled.rule;
  }
  return null;
}

/** What the import does with one new payment after auto-match had its turn. */
export type AfterMatchDecision<R> = { kind: "matched" } | { kind: "rule"; rule: R } | { kind: "auto_draft" } | { kind: "leave" };

/**
 * Invoices always come first: a payment auto-match settled or linked is
 * never touched by a rule. Then the rules, then the PayPal auto-draft.
 */
export function decideAfterMatch<R extends RuleLike>(
  matched: boolean,
  payment: PaymentForRules,
  rules: CompiledRule<R>[],
  options: { drafts?: boolean; autoDraft?: boolean } = {},
): AfterMatchDecision<R> {
  if (matched) return { kind: "matched" };
  const rule = firstMatchingRule(rules, payment, options);
  if (rule) return { kind: "rule", rule };
  return options.autoDraft ? { kind: "auto_draft" } : { kind: "leave" };
}

/** Which stored payments one rule would act on: only those still unmatched. */
export function ruleHits<T extends PaymentForRules & { status: string }>(rule: RuleLike, payments: T[]): T[] {
  const compiled = compileRule({ ...rule, enabled: true });
  return payments.filter((p) => p.status === "unmatched" && compiled.matches(p));
}

/** import_only rules replaced an owner/admin setting on the connection and keep its access. */
export function canManageImportRules(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** What `importWordsFor` needs of a rule. */
export interface ImportRuleLike {
  enabled?: boolean;
  action: RuleAction | string;
  conditions: Pick<RuleConditions, "keywords">;
  connectionId?: string | null;
}

/**
 * The words a PSD2 connection's movements must contain to be stored, from
 * every enabled import_only rule for this connection or for all of them. A
 * movement is kept when it fits any rule, so the words are simply pooled.
 * Null when no such rule applies: the sync then keeps incoming payments
 * only, as it always did. A rule without words is skipped rather than read
 * as "keep everything", which would let the debits in.
 */
export function importWordsFor(rules: ImportRuleLike[], connectionId: string): string[] | null {
  const words = rules
    .filter((r) => r.enabled !== false && r.action === "import_only" && (r.connectionId == null || r.connectionId === connectionId))
    .flatMap((r) => filterWords(r.conditions.keywords));
  return words.length > 0 ? [...new Set(words)] : null;
}

/** Whether a fetched movement may be stored, given `importWordsFor`'s answer. */
export function keepOnImport(row: ParsedBankTransactionRow, words: string[] | null): boolean {
  return words === null || passesImportFilter(row, words);
}
