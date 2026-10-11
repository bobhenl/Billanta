/**
 * Custom header fields: plain text with `{placeholders}`, a fixed amount, a
 * percentage of the base, or a formula over the amount variables and the
 * other fields (`{base} - {naklady}`, `({base} - {tax}) * 50 %`).
 *
 * Pure and dependency-free — copy of apps/backend/src/invoices/custom-fields.ts (keep in sync).
 */

export type CustomFieldKind = "text" | "amount" | "percent" | "formula";

export interface CustomField {
  label: string;
  value: string;
  kind?: CustomFieldKind;
  /** Internal fields are shown to the team only, never on the PDF or the portal. */
  internal?: boolean;
}

export interface DocTotals {
  totalWithoutVat: number;
  totalVat: number;
  totalWithVat: number;
}

/** `{net}`, `{tax}`, `{social}`, `{health}` assume the most common 60 % flat-rate expenses. */
export const NET_FLAT_RATE = 60;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Marginal Czech OSVČ burden of one invoice: 15 % income tax, social 29.2 % of
 * 55 % and health 13.5 % of 50 % of the profit (base minus flat-rate expenses).
 * No minimums, credits or the 23 % band — "what this invoice costs you".
 */
export function burdenOf(base: number, flatRate = NET_FLAT_RATE) {
  const profit = Math.max(0, base) * (1 - flatRate / 100);
  const tax = round2(profit * 0.15);
  const social = round2(profit * 0.55 * 0.292);
  const health = round2(profit * 0.5 * 0.135);
  return { profit: round2(profit), tax, social, health, net: round2(base - tax - social - health) };
}

/** The numeric variables every formula and placeholder can use. */
export function numericVars(totals: DocTotals, amountPaid?: number | string | null): Record<string, number> {
  const paid = Number(amountPaid ?? 0) || 0;
  const b = burdenOf(totals.totalWithoutVat);
  return {
    amount: totals.totalWithVat,
    base: totals.totalWithoutVat,
    vat: totals.totalVat,
    paid,
    remaining: Math.max(0, round2(totals.totalWithVat - paid)),
    net: b.net,
    tax: b.tax,
    social: b.social,
    health: b.health,
    insurance: round2(b.social + b.health),
  };
}

/** "Náklady na materiál" → `naklady_na_material` — how other fields refer to this one. */
export function fieldKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const parseNumber = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));

/**
 * Evaluates `+ - * /`, parentheses, decimal commas and `N %` (= N/100) with
 * `{variables}`. A small recursive-descent parser — never `eval`. Returns null
 * for anything malformed or an unknown variable.
 */
export function evalFormula(expr: string, vars: Record<string, number>): number | null {
  const src = expr.replace(/\{([a-z0-9_]+)\}/gi, (_, k: string) => {
    const v = vars[k.toLowerCase()];
    return v === undefined || !Number.isFinite(v) ? "\u0000" : `(${v})`;
  });
  if (src.includes("\u0000")) return null;
  const tokens = src.match(/\d+(?:[.,]\d+)?|[-+*/()%]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const fail = (): never => {
    throw new Error("bad formula");
  };
  const primary = (): number => {
    const tok = tokens[i++];
    if (tok === undefined) return fail();
    if (tok === "(") {
      const v = sum();
      if (tokens[i++] !== ")") fail();
      return v;
    }
    if (tok === "-") return -factor();
    if (tok === "+") return factor();
    if (/^\d/.test(tok)) return parseNumber(tok);
    return fail();
  };
  const factor = (): number => {
    let v = primary();
    while (peek() === "%") {
      i++;
      v /= 100;
    }
    return v;
  };
  const product = (): number => {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = tokens[i++];
      const r = factor();
      if (op === "/" && r === 0) return fail();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") {
      const op = tokens[i++];
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  try {
    if (!tokens.length) return null;
    const v = sum();
    return i === tokens.length && Number.isFinite(v) ? round2(v) : null;
  } catch {
    return null;
  }
}

/** The number a field stands for (null for text or unparsable input). */
function numericValue(field: CustomField, vars: Record<string, number>): number | null {
  const kind = field.kind ?? "text";
  if (kind === "amount") {
    const n = parseNumber(field.value);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "percent") {
    const n = parseNumber(field.value);
    return Number.isFinite(n) ? round2((vars.base! * n) / 100) : null;
  }
  if (kind === "formula") return evalFormula(field.value, vars);
  return null;
}

/**
 * All variables for a document: the amount variables, the company's own
 * variables that hold a number (`{paypal_procento}` = 3,4) and every numeric
 * field under its {@link fieldKey}. Fields may reference each other in any
 * order (resolved in passes; cycles stay unresolved). A field never overrides
 * a built-in or company variable.
 */
export function resolveVars(
  fields: CustomField[] | null | undefined,
  totals: DocTotals,
  amountPaid?: number | string | null,
  companyVars: { key: string; value: string }[] = [],
): Record<string, number> {
  const vars = numericVars(totals, amountPaid);
  for (const v of companyVars) {
    const n = parseNumber(v.value);
    if (v.value.trim() && Number.isFinite(n) && !(v.key in vars)) vars[v.key] = n;
  }
  const reserved = new Set(Object.keys(vars));
  const list = (fields ?? []).filter((f) => f.kind && f.kind !== "text" && fieldKey(f.label) && !reserved.has(fieldKey(f.label)));
  for (let pass = 0; pass <= list.length; pass++) {
    let changed = false;
    for (const f of list) {
      const key = fieldKey(f.label);
      const v = numericValue(f, vars);
      if (v !== null && vars[key] !== v) {
        vars[key] = v;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return vars;
}

/** Variables formatted for `{placeholder}` filling in texts and e-mails. */
export function formattedVars(vars: Record<string, number>, format: (n: number) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, format(v)]));
}

/** The value as printed: amounts formatted, `10` % → "10 % (1 000,00 Kč)", formulas computed, `{placeholders}` filled. */
export function displayCustomField(
  field: CustomField,
  vars: Record<string, number>,
  format: (n: number) => string,
  fill: (text: string) => string,
): string {
  const kind = field.kind ?? "text";
  if (kind === "text") return fill(field.value);
  const n = numericValue(field, vars);
  if (n === null) return kind === "formula" ? "–" : fill(field.value);
  if (kind === "percent") return `${field.value.trim()} % (${format(n)})`;
  return format(n);
}

/**
 * Everything a rendered document needs: the numbers (for custom fields) and
 * the formatted values to merge into the `{placeholder}` fill. Company
 * variables are left out of `formatted` so `{paypal_procento}` keeps the text
 * the company typed instead of turning into an amount.
 */
export function documentVars(
  fields: CustomField[] | null | undefined,
  totals: DocTotals,
  amountPaid: number | string | null | undefined,
  companyVars: { key: string; value: string }[],
  format: (n: number) => string,
) {
  const numbers = resolveVars(fields, totals, amountPaid, companyVars);
  const company = new Set(companyVars.map((v) => v.key));
  const formatted = formattedVars(
    Object.fromEntries(Object.entries(numbers).filter(([k]) => !company.has(k))),
    format,
  );
  return { numbers, formatted };
}
