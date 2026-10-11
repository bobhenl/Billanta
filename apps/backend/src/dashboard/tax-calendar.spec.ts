import { describe, expect, it } from "vitest";
import { classifyTaxEvent, parseTaxCalendarCsv } from "./tax-calendar";

const CSV =
  "﻿Datum;Dan;Popis\r\n" +
  '20.10.2026;"daň z příjmů";"splatnost paušální zálohy"\r\n' +
  '26.10.2026;"daň z přidané hodnoty";"kontrolní hlášení za 3. čtvrtletí a za září 2026"\r\n' +
  '25.11.2026;"daň z přidané hodnoty";"daňové přiznání a splatnost daně za říjen 2026"\r\n' +
  '31.10.2026;"daň z přidané hodnoty";"podání Oznámení CESOP za 3 . čtvrtletí 2026"\r\n' +
  '01.04.2026;"daň z příjmů";"podání přiznání k dani z příjmů a úhrada daně za rok 2025; základní lhůta"\r\n' +
  '20.11.2026;"daň z příjmů";"měsíční odvod úhrnu sražených záloh   za říjen 2026"\r\n' +
  'bad;"x";"y"\r\n';

describe("parseTaxCalendarCsv", () => {
  const rows = parseTaxCalendarCsv(CSV);

  it("parses dates, quoted fields with semicolons and collapses whitespace", () => {
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ date: "2026-10-20", kind: "flat_tax" });
    expect(rows[4]!.description).toBe("podání přiznání k dani z příjmů a úhrada daně za rok 2025; základní lhůta");
    expect(rows[5]!.description).toBe("měsíční odvod úhrnu sražených záloh za říjen 2026");
  });

  it("classifies rows and flags quarterly VAT", () => {
    expect(rows.map((r) => r.kind)).toEqual(["flat_tax", "vat", "vat", "vat_other", "income_tax", "payroll"]);
    expect(rows[1]!.quarterly).toBe(true);
    expect(rows[2]!.quarterly).toBe(false);
  });
});

describe("classifyTaxEvent", () => {
  it("tolerates the stray spaces Finanční správa leaves inside words", () => {
    expect(classifyTaxEvent("daň z nemovit ých věcí", "splatnost daně")).toBe("property_tax");
    expect(classifyTaxEvent("daň silniční", "daňové přiznání a splatnost daně za rok 2025")).toBe("road_tax");
    expect(classifyTaxEvent("spotřební daň", "splatnost daně")).toBe("other");
  });
});
