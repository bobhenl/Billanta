import { describe, expect, it } from "vitest";
import { enumerableCustomFields, hasCustomValue, parseCustomValue } from "./custom-field-options";

const f = (label: string, value: string, kind?: "text" | "amount") => ({ label, value, ...(kind && { kind }) });

describe("enumerableCustomFields", () => {
  it("offers a field with few repeating values as a list", () => {
    const docs = [[f("Projekt", "A")], [f("Projekt", "B ")], [f("Projekt", "A")], null];
    expect(enumerableCustomFields(docs)).toEqual([{ label: "Projekt", values: ["A", "B"] }]);
  });

  it("leaves a field whose value is different every time as free text", () => {
    expect(enumerableCustomFields([[f("Objednávka", "1")], [f("Objednávka", "2")], [f("Objednávka", "3")]])).toEqual([]);
  });

  it("skips amount fields and fields with too many values", () => {
    const many = Array.from({ length: 20 }, (_, i) => [f("Kód", String(i % 14))]);
    expect(enumerableCustomFields([...many, [f("Sleva", "100", "amount")], [f("Sleva", "100", "amount")]])).toEqual([]);
  });
});

describe("custom value filter", () => {
  it("parses only a two-string array", () => {
    expect(parseCustomValue('["Projekt"," A "]')).toEqual(["Projekt", "A"]);
    expect(parseCustomValue("Projekt")).toBeNull();
    expect(parseCustomValue('["a",1]')).toBeNull();
  });

  it("matches the exact label and value", () => {
    expect(hasCustomValue([f("Projekt", "A ")], ["Projekt", "A"])).toBe(true);
    expect(hasCustomValue([f("Projekt", "AB")], ["Projekt", "A"])).toBe(false);
    expect(hasCustomValue([f("Jiné", "A")], ["Projekt", "A"])).toBe(false);
  });
});
