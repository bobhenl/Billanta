import { afterEach, describe, expect, it, vi } from "vitest";
import { clearEcbCache, getEcbRate, parseEcbCsv } from "./ecb-rates";

const CSV = `KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS
EXR.D.CZK.EUR.SP00.A,D,CZK,EUR,SP00,A,2026-09-10,24.310,A
EXR.D.CZK.EUR.SP00.A,D,CZK,EUR,SP00,A,2026-09-11,24.355,A
EXR.D.CZK.EUR.SP00.A,D,CZK,EUR,SP00,A,2026-09-14,24.400,A
`;

afterEach(() => {
  vi.unstubAllGlobals();
  clearEcbCache();
});

describe("parseEcbCsv", () => {
  it("takes the last fixing on or before the day", () => {
    expect(parseEcbCsv(CSV, "2026-09-13")).toBe(24.355);
    expect(parseEcbCsv(CSV, "2026-09-14")).toBe(24.4);
    expect(parseEcbCsv(CSV, "2026-09-01")).toBeNull();
    expect(parseEcbCsv("", "2026-09-14")).toBeNull();
  });
});

describe("getEcbRate", () => {
  it("uses the fixing of the day before the tax point", async () => {
    const fetchMock = vi.fn(async () => new Response(CSV));
    vi.stubGlobal("fetch", fetchMock);
    // Tax point Monday 14 Sep → Friday's rate.
    expect(await getEcbRate("czk", new Date(2026, 8, 14))).toBe(24.355);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("D.CZK.EUR.SP00.A");
    await getEcbRate("CZK", new Date(2026, 8, 14));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("needs no lookup for EUR and fails soft", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await getEcbRate("EUR", new Date())).toBe(1);
    expect(await getEcbRate("USD", new Date(2026, 8, 14))).toBeNull();
  });
});
