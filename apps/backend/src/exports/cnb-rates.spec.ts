import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCnbCache, getCnbDay, getCnbRate, parseCnbDay, parseCurrencyList, parseRateDate } from "./cnb-rates";

// Friday's list, which ČNB also serves for the weekend after it.
const FRIDAY =
  "09.10.2026 #196\n" +
  "země|měna|množství|kód|kurz\n" +
  "EMU|euro|1|EUR|24,315\n" +
  "Japonsko|jen|100|JPY|15,402\n" +
  "USA|dolar|1|USD|20,875\n" +
  "broken line\n" +
  "Nikde|nic|0|XXX|1,000\n";

describe("parseCnbDay", () => {
  it("reads the published date and normalises rates to one unit", () => {
    const day = parseCnbDay(FRIDAY)!;
    expect(day.date).toBe("2026-10-09");
    expect(day.rates.get("EUR")).toEqual({ rate: 24.315, country: "EMU", name: "euro" });
    expect(day.rates.get("JPY")!.rate).toBeCloseTo(0.15402, 8);
    expect([...day.rates.keys()]).toEqual(["EUR", "JPY", "USD"]);
  });

  it("handles CRLF and rejects a body without a date header or rows", () => {
    expect(parseCnbDay(FRIDAY.replace(/\n/g, "\r\n"))!.rates.get("USD")!.rate).toBe(20.875);
    expect(parseCnbDay("<html>error</html>")).toBeNull();
    expect(parseCnbDay("16.10.2026 #201\nzemě|měna|množství|kód|kurz\n")).toBeNull();
  });
});

describe("parseRateDate", () => {
  const now = new Date(2026, 9, 17, 10, 0); // Saturday 17.10.2026

  it("defaults to today and accepts past days", () => {
    expect((parseRateDate(undefined, now) as { date: Date }).date).toBe(now);
    const d = (parseRateDate("2026-10-17", now) as { date: Date }).date;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 17]);
    expect("date" in parseRateDate("1991-01-01", now)).toBe(true);
  });

  it("rejects malformed, impossible, future and pre-1991 dates", () => {
    expect(parseRateDate("17.10.2026", now)).toEqual({ error: "date must be YYYY-MM-DD" });
    expect(parseRateDate("2026-02-30", now)).toEqual({ error: "date is not a valid calendar day" });
    expect(parseRateDate("2026-10-18", now)).toEqual({ error: "date must not be in the future" });
    expect(parseRateDate("1990-12-31", now)).toEqual({ error: "date must not be before 1991-01-01" });
  });
});

describe("parseCurrencyList", () => {
  it("uppercases, drops CZK and duplicates", () => {
    expect(parseCurrencyList(" eur,USD,czk,EUR ")).toEqual({ codes: ["EUR", "USD"] });
    expect(parseCurrencyList(undefined)).toEqual({ codes: ["EUR", "USD", "GBP"] });
  });

  it("rejects bad codes, an empty list and too many codes", () => {
    expect(parseCurrencyList("EUR,EURO")).toEqual({ error: "invalid currency code: EURO" });
    expect(parseCurrencyList("EUR,../x")).toEqual({ error: "invalid currency code: ../X" });
    expect(parseCurrencyList(" , ")).toEqual({ error: "currencies must not be empty" });
    expect(parseCurrencyList("AAA,BBB,CCC", 2)).toEqual({ error: "at most 2 currencies" });
  });
});

describe("getCnbDay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCnbCache();
  });

  it("asks ČNB for the weekend day and reports the Friday the list is from, cached", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(FRIDAY));
    vi.stubGlobal("fetch", fetchMock);
    const saturday = new Date(2026, 9, 10);
    const day = await getCnbDay(saturday);
    expect(day!.date).toBe("2026-10-09");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("?date=10.10.2026");
    expect(await getCnbRate("eur", saturday)).toBe(24.315);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(new Response(FRIDAY));
    vi.stubGlobal("fetch", fetchMock);
    const friday = new Date(2026, 9, 9);
    expect(await getCnbDay(friday)).toBeNull();
    expect((await getCnbDay(friday))!.date).toBe("2026-10-09");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 1 for CZK without fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getCnbRate("CZK")).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
