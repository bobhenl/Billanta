import { describe, expect, it } from "vitest";
import {
  checkRegex,
  compileRule,
  decideAfterMatch,
  firstMatchingRule,
  foldText,
  ruleBodySchema,
  ruleHits,
  validateRule,
  type PaymentForRules,
  type RuleConditions,
  type RuleLike,
} from "./bank-rules";

function payment(overrides: Partial<PaymentForRules> = {}): PaymentForRules {
  return {
    amount: -1290,
    currency: "CZK",
    counterpartyName: "Vodafone Czech Republic a.s.",
    counterpartyAccount: "CZ6508000000192000145399",
    message: "Platba za telefon 10/2026",
    variableSymbol: "0001234567",
    ...overrides,
  };
}

function rule(conditions: Partial<RuleConditions>, action: RuleLike["action"] = "ignore", id = "r1"): RuleLike {
  return { id, enabled: true, action, conditions: { text: [], direction: "any", ...conditions } };
}

const matches = (r: RuleLike, p: PaymentForRules) => compileRule(r).matches(p);

describe("text conditions", () => {
  it("contains ignores case and accents", () => {
    const r = rule({ text: [{ field: "counterparty_name", operator: "contains", value: "VODAFONE" }] });
    expect(matches(r, payment())).toBe(true);
    const accents = rule({ text: [{ field: "message", operator: "contains", value: "platba za telefón" }] });
    expect(matches(accents, payment())).toBe(true);
    expect(matches(r, payment({ counterpartyName: "T-Mobile" }))).toBe(false);
  });

  it("contains looks only at the chosen field", () => {
    const r = rule({ text: [{ field: "message", operator: "contains", value: "vodafone" }] });
    expect(matches(r, payment())).toBe(false);
  });

  it("any text looks at every field", () => {
    const byAccount = rule({ text: [{ field: "any", operator: "contains", value: "192000145399" }] });
    const byVs = rule({ text: [{ field: "any", operator: "contains", value: "1234567" }] });
    expect(matches(byAccount, payment())).toBe(true);
    expect(matches(byVs, payment())).toBe(true);
    expect(matches(byVs, payment({ variableSymbol: null }))).toBe(false);
  });

  it("equals needs the whole value, but still ignores case, accents and spacing", () => {
    const r = rule({ text: [{ field: "counterparty_name", operator: "equals", value: "vodafone  czech republic a.s." }] });
    expect(matches(r, payment())).toBe(true);
    expect(matches(rule({ text: [{ field: "counterparty_name", operator: "equals", value: "Vodafone" }] }), payment())).toBe(false);
  });

  it("equals on the variable symbol ignores leading zeros", () => {
    const r = rule({ text: [{ field: "variable_symbol", operator: "equals", value: "1234567" }] });
    expect(matches(r, payment())).toBe(true);
    expect(matches(rule({ text: [{ field: "variable_symbol", operator: "equals", value: "123456" }] }), payment())).toBe(false);
  });

  it("matches a PayPal payer by e-mail in the account field", () => {
    const r = rule({ text: [{ field: "counterparty_account", operator: "equals", value: "Buyer@Example.com" }] });
    expect(matches(r, payment({ counterpartyAccount: "buyer@example.com" }))).toBe(true);
  });

  it("regex is case-insensitive and tested per field", () => {
    const r = rule({ text: [{ field: "message", operator: "regex", value: "^platba za telefon \\d{2}/2026$" }] });
    expect(matches(r, payment())).toBe(true);
    expect(matches(r, payment({ message: "Platba za internet 10/2026" }))).toBe(false);
  });

  it("all text conditions have to hold", () => {
    const r = rule({
      text: [
        { field: "counterparty_name", operator: "contains", value: "vodafone" },
        { field: "message", operator: "contains", value: "internet" },
      ],
    });
    expect(matches(r, payment())).toBe(false);
    expect(matches(r, payment({ message: "internet" }))).toBe(true);
  });
});

describe("direction, currency and amount", () => {
  const name = { field: "counterparty_name" as const, operator: "contains" as const, value: "vodafone" };

  it("direction in / out / any", () => {
    expect(matches(rule({ text: [name], direction: "out" }), payment())).toBe(true);
    expect(matches(rule({ text: [name], direction: "out" }), payment({ amount: 1290 }))).toBe(false);
    expect(matches(rule({ text: [name], direction: "in" }), payment())).toBe(false);
    expect(matches(rule({ text: [name], direction: "in" }), payment({ amount: 1290 }))).toBe(true);
    expect(matches(rule({ text: [name], direction: "any" }), payment({ amount: 1290 }))).toBe(true);
  });

  it("currency must be the same", () => {
    expect(matches(rule({ text: [name], currency: "CZK" }), payment())).toBe(true);
    expect(matches(rule({ text: [name], currency: "EUR" }), payment())).toBe(false);
  });

  it("amount bounds use the absolute value and include the edges", () => {
    const r = rule({ minAmount: 1000, maxAmount: 1290 });
    expect(matches(r, payment({ amount: -1290 }))).toBe(true);
    expect(matches(r, payment({ amount: 1000 }))).toBe(true);
    expect(matches(r, payment({ amount: -999.99 }))).toBe(false);
    expect(matches(r, payment({ amount: -1290.01 }))).toBe(false);
    expect(matches(rule({ minAmount: 1291 }), payment())).toBe(false);
    expect(matches(rule({ maxAmount: 1289 }), payment())).toBe(false);
  });

  it("a draft action only ever fits its own direction", () => {
    expect(matches(rule({ minAmount: 1 }, "draft_expense"), payment({ amount: 500 }))).toBe(false);
    expect(matches(rule({ minAmount: 1 }, "draft_invoice"), payment({ amount: -500 }))).toBe(false);
  });

  it("a rule without a text or amount condition matches nothing", () => {
    expect(matches(rule({ direction: "out" }), payment())).toBe(false);
  });
});

describe("validateRule", () => {
  const text = [{ field: "any" as const, operator: "contains" as const, value: "x" }];

  it("needs a text or amount condition", () => {
    expect(validateRule({ action: "ignore", conditions: { text: [], direction: "out" } })).toBe("rule_needs_condition");
    expect(validateRule({ action: "ignore", conditions: { text: [], direction: "any", minAmount: 10 } })).toBeNull();
    expect(validateRule({ action: "ignore", conditions: { text, direction: "any" } })).toBeNull();
  });

  it("refuses min above max", () => {
    expect(validateRule({ action: "ignore", conditions: { text, direction: "any", minAmount: 10, maxAmount: 5 } })).toBe("invalid_amount_range");
  });

  it("refuses an invalid regex", () => {
    const conditions = { text: [{ field: "any" as const, operator: "regex" as const, value: "([a-z" }], direction: "any" as const };
    expect(validateRule({ action: "ignore", conditions })).toBe("invalid_regex");
  });

  it("refuses a catastrophic regex", () => {
    const conditions = { text: [{ field: "any" as const, operator: "regex" as const, value: "(a+)+$" }], direction: "any" as const };
    expect(validateRule({ action: "ignore", conditions })).toBe("unsafe_regex");
  });

  it("ties draft actions to a direction", () => {
    expect(validateRule({ action: "draft_expense", conditions: { text, direction: "any" } })).toBe("action_needs_outgoing");
    expect(validateRule({ action: "draft_expense", conditions: { text, direction: "out" } })).toBeNull();
    expect(validateRule({ action: "draft_invoice", conditions: { text, direction: "out" } })).toBe("action_needs_incoming");
    expect(validateRule({ action: "draft_invoice", conditions: { text, direction: "in" } })).toBeNull();
  });

  it("the body schema caps the pattern length and defaults the operator to contains", () => {
    const base = { name: "x", action: "ignore", conditions: { text: [{ field: "any", value: "a".repeat(201) }] } };
    expect(ruleBodySchema.safeParse(base).success).toBe(false);
    const ok = ruleBodySchema.parse({ ...base, conditions: { text: [{ field: "any", value: "abc" }] } });
    expect(ok.conditions.text[0].operator).toBe("contains");
    expect(ok.conditions.direction).toBe("any");
  });
});

describe("checkRegex", () => {
  it.each(["^vodafone", "platba \\d+/2026", "(?:ab)+c", "[a-z]{2,5}\\d", "foo|bar", "(?<x>abc)\\s*", "\\p{L}+"])("accepts %s", (p) => {
    expect(checkRegex(p)).toBeNull();
  });

  it.each([
    ["(a+)+", "nested quantifier"],
    ["(a*)*b", "nested star"],
    ["((ab)+)+", "deeper nesting"],
    ["((a+)b)+", "a repeat two groups down"],
    ["(a|aa)+", "repeated alternation"],
    ["(\\w+\\s?){3,}", "repeated group with a quantifier inside"],
    ["(a)\\1", "backreference"],
    ["(?=a)a", "lookahead"],
    ["(?<!a)b", "lookbehind"],
    [".*.*.*x", "three unbounded quantifiers"],
    ["a{1,100}b{1,100}c{1,100}", "wide ranges count as unbounded"],
  ])("rejects %s (%s)", (p) => {
    expect(checkRegex(p)).toBe("unsafe_regex");
  });

  it("rejects broken and too long patterns", () => {
    expect(checkRegex("(abc")).toBe("invalid_regex");
    expect(checkRegex("a".repeat(201))).toBe("invalid_regex");
    expect(checkRegex("")).toBe("invalid_regex");
  });

  it("a stored pattern that is unsafe never matches", () => {
    const r = rule({ text: [{ field: "any", operator: "regex", value: "(a+)+" }] });
    expect(matches(r, payment({ message: "aaaa" }))).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  const vodafone = { field: "counterparty_name" as const, operator: "contains" as const, value: "vodafone" };

  it("the first fitting rule wins, in the given order", () => {
    const rules = [rule({ text: [vodafone], currency: "EUR" }, "ignore", "a"), rule({ text: [vodafone] }, "ignore", "b"), rule({ minAmount: 1 }, "ignore", "c")];
    expect(firstMatchingRule(rules.map((r) => compileRule(r)), payment())?.id).toBe("b");
  });

  it("skips disabled rules", () => {
    const rules = [{ ...rule({ text: [vodafone] }, "ignore", "a"), enabled: false }, rule({ minAmount: 1 }, "ignore", "b")];
    expect(firstMatchingRule(rules.map((r) => compileRule(r)), payment())?.id).toBe("b");
  });

  it("without drafts (backfill) a fitting draft rule stops the search", () => {
    const rules = [rule({ text: [vodafone], direction: "out" }, "draft_expense", "a"), rule({ minAmount: 1 }, "ignore", "b")];
    const compiled = rules.map((r) => compileRule(r));
    expect(firstMatchingRule(compiled, payment(), { drafts: false })).toBeNull();
    expect(firstMatchingRule(compiled, payment())?.id).toBe("a");
  });
});

describe("decideAfterMatch", () => {
  const rules = [compileRule(rule({ minAmount: 1 }, "ignore", "r1"))];

  it("an invoice match always wins over a fitting rule", () => {
    expect(decideAfterMatch(true, payment(), rules)).toEqual({ kind: "matched" });
  });

  it("an unmatched payment goes to the rule", () => {
    expect(decideAfterMatch(false, payment(), rules)).toMatchObject({ kind: "rule", rule: { id: "r1" } });
  });

  it("a rule comes before the PayPal auto-draft, which still runs when no rule fits", () => {
    expect(decideAfterMatch(false, payment(), rules, { autoDraft: true })).toMatchObject({ kind: "rule" });
    expect(decideAfterMatch(false, payment(), [], { autoDraft: true })).toEqual({ kind: "auto_draft" });
    expect(decideAfterMatch(false, payment(), [])).toEqual({ kind: "leave" });
  });
});

describe("ruleHits", () => {
  it("only unmatched payments are touched", () => {
    const rows = [
      { ...payment(), status: "unmatched", id: "u" },
      { ...payment(), status: "matched", id: "m" },
      { ...payment(), status: "ignored", id: "i" },
    ];
    expect(ruleHits(rule({ minAmount: 1 }), rows).map((r) => r.id)).toEqual(["u"]);
  });

  it("previews a disabled rule too", () => {
    const rows = [{ ...payment(), status: "unmatched" }];
    expect(ruleHits({ ...rule({ minAmount: 1 }), enabled: false }, rows)).toHaveLength(1);
  });
});

describe("foldText", () => {
  it("drops diacritics, case and extra spaces", () => {
    expect(foldText("  Žluťoučký   KŮŇ ")).toBe("zlutoucky kun");
  });
});
