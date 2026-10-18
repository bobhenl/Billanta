import { describe, expect, it, vi } from "vitest";

// No network: fixed ČNB and ECB answers for any day.
const fx = vi.hoisted(() => ({
  getCnbDay: vi.fn(async () => ({ date: "2026-03-13", rates: new Map([["EUR", { rate: 25.12, country: "EMU", name: "euro" }]]) })),
  getEcbFixing: vi.fn(async (currency: string) => (currency === "CZK" ? { rate: 25.2, day: "2026-03-13" } : null)),
}));
vi.mock("./cnb-rates", () => ({ getCnbDay: fx.getCnbDay }));
vi.mock("./ecb-rates", () => ({ getEcbFixing: fx.getEcbFixing }));

import { getHomeRate, getHomeRateDay } from "./home-rates";

const day = new Date("2026-03-14T10:00:00Z");

describe("getHomeRateDay", () => {
  it("a Czech company gets the ČNB rate and the list day", async () => {
    expect(await getHomeRateDay("CZK", "eur", day)).toEqual({ rate: 25.12, date: "2026-03-13", source: "cnb" });
  });
  it("a Slovak company gets EUR per unit, inverted from the ECB quote", async () => {
    expect(await getHomeRateDay("EUR", "CZK", day)).toEqual({ rate: 1 / 25.2, date: "2026-03-13", source: "ecb" });
    expect(fx.getEcbFixing).toHaveBeenCalledWith("CZK", day);
  });
  it("is null at home and for a currency the source does not quote", async () => {
    expect(await getHomeRateDay("EUR", "EUR", day)).toBeNull();
    expect(await getHomeRateDay("EUR", "XYZ", day)).toBeNull();
    expect(await getHomeRateDay("CZK", "XYZ", day)).toBeNull();
  });
});

describe("getHomeRate", () => {
  it("is 1 at home", async () => {
    expect(await getHomeRate("EUR", "eur")).toBe(1);
    expect(await getHomeRate("CZK", "CZK")).toBe(1);
  });
});
