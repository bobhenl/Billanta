import { describe, expect, it } from "vitest";
import { burdenOf, displayCustomField, evalFormula, fieldKey, resolveVars } from "./custom-fields";

const totals = { totalWithoutVat: 10_000, totalVat: 2_100, totalWithVat: 12_100 };
const fmt = (n: number) => n.toFixed(2);

describe("evalFormula", () => {
  it("does arithmetic with precedence, parentheses, decimal commas and percent", () => {
    expect(evalFormula("1 + 2 * 3", {})).toBe(7);
    expect(evalFormula("(1 + 2) * 3", {})).toBe(9);
    expect(evalFormula("10,5 - 0,5", {})).toBe(10);
    expect(evalFormula("{base} * 20 %", { base: 1000 })).toBe(200);
    expect(evalFormula("-{a} + 5", { a: 2 })).toBe(3);
  });

  it("rejects unknown variables, garbage and division by zero", () => {
    expect(evalFormula("{nope} + 1", {})).toBeNull();
    expect(evalFormula("1 +", {})).toBeNull();
    expect(evalFormula("alert(1)", {})).toBeNull();
    expect(evalFormula("1 / 0", {})).toBeNull();
    expect(evalFormula("", {})).toBeNull();
  });
});

describe("resolveVars", () => {
  it("exposes tax, social and health that add up to the net", () => {
    const v = resolveVars([], totals);
    const b = burdenOf(10_000);
    expect(v.tax).toBe(b.tax);
    expect(v.base - v.tax - v.social - v.health).toBeCloseTo(v.net, 2);
    expect(v.insurance).toBeCloseTo(v.social + v.health, 2);
  });

  it("lets fields reference each other and company number variables", () => {
    const v = resolveVars(
      [
        { label: "Marže", value: "{base} - {naklady} - {poplatek}", kind: "formula" },
        { label: "Náklady", value: "3000", kind: "amount" },
        { label: "Poplatek", value: "{amount} * {paypal_procento} % + 10", kind: "formula" },
      ],
      totals,
      0,
      [{ key: "paypal_procento", value: "3,4" }],
    );
    expect(v.poplatek).toBe(421.4);
    expect(v.marze).toBe(10_000 - 3000 - 421.4);
  });

  it("never lets a field override a built-in variable", () => {
    expect(resolveVars([{ label: "Base", value: "1", kind: "amount" }], totals).base).toBe(10_000);
  });
});

describe("displayCustomField", () => {
  const vars = resolveVars([], totals);
  it("formats each kind", () => {
    expect(displayCustomField({ label: "x", value: "{base} - {tax}", kind: "formula" }, vars, fmt, (s) => s)).toBe(fmt(10_000 - vars.tax!));
    expect(displayCustomField({ label: "x", value: "20", kind: "percent" }, vars, fmt, (s) => s)).toBe("20 % (2000.00)");
    expect(displayCustomField({ label: "x", value: "oops +", kind: "formula" }, vars, fmt, (s) => s)).toBe("–");
  });
});

it("fieldKey strips diacritics", () => {
  expect(fieldKey("Náklady na materiál")).toBe("naklady_na_material");
});
