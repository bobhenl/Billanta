import { describe, expect, it } from "vitest";
import { writeXlsxFixture } from "./xlsx-fixture";
import { excelSerialToIso, isLegacyXls, isXlsx, readXlsx, XlsxError } from "./xlsx-read";

describe("readXlsx", () => {
  it("reads shared strings, numbers, booleans and date cells of the first sheet", () => {
    const buf = writeXlsxFixture([
      ["Číslo", "Odběratel", "Vystaveno", "Celkem", "Zaplaceno"],
      ["FV2025001", "Alfa & syn s.r.o.", new Date(Date.UTC(2025, 2, 14)), 1210.5, true],
      ["FV2025002", "<Beta>", new Date(Date.UTC(2025, 11, 31)), 0.1 + 0.2, false],
    ]);
    expect(isXlsx(buf)).toBe(true);
    expect(readXlsx(buf)).toEqual([
      ["Číslo", "Odběratel", "Vystaveno", "Celkem", "Zaplaceno"],
      ["FV2025001", "Alfa & syn s.r.o.", "2025-03-14", "1210.5", "1"],
      ["FV2025002", "<Beta>", "2025-12-31", "0.3", "0"],
    ]);
  });

  it("keeps column positions across empty cells and rows", () => {
    const rows = readXlsx(writeXlsxFixture([["a", null, "c"], [], ["x", "y"]]));
    expect(rows).toEqual([["a", "", "c"], [], ["x", "y"]]);
  });

  it("refuses what is not a zip", () => {
    expect(() => readXlsx(Buffer.from("Číslo;Odběratel\n"))).toThrow(XlsxError);
  });

  it("tells the old binary .xls apart", () => {
    expect(isLegacyXls(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe(true);
    expect(isXlsx(Buffer.from("a;b"))).toBe(false);
  });

  it("converts Excel day numbers", () => {
    expect(excelSerialToIso(45000)).toBe("2023-03-15");
    expect(excelSerialToIso(1)).toBe("1899-12-31");
    expect(excelSerialToIso(-3)).toBeNull();
  });
});
