import { describe, expect, it } from "vitest";
import { toCsv } from "./classroom-classes.service";

describe("toCsv", () => {
  it("joins rows with CRLF and quotes what needs it", () => {
    expect(toCsv([["nickname", "invoices"], ['Pepa "Z"', "3"], ["a,b", "1"]])).toBe('nickname,invoices\r\n"Pepa ""Z""",3\r\n"a,b",1\r\n');
  });

  it("defuses spreadsheet formulas in nicknames", () => {
    expect(toCsv([["=1+1", "+x", "-2", "@a"]])).toBe("'=1+1,'+x,'-2,'@a\r\n");
  });
});
