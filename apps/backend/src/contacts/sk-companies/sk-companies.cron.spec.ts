import { describe, expect, it } from "vitest";
import { skCompaniesSyncEnabled } from "./sk-companies.cron";

describe("skCompaniesSyncEnabled", () => {
  it("is on in production unless switched off, off elsewhere unless switched on", () => {
    expect(skCompaniesSyncEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(skCompaniesSyncEnabled({ NODE_ENV: "production", SK_COMPANIES_SYNC: " OFF " })).toBe(false);
    expect(skCompaniesSyncEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(skCompaniesSyncEnabled({})).toBe(false);
    expect(skCompaniesSyncEnabled({ NODE_ENV: "development", SK_COMPANIES_SYNC: "on" })).toBe(true);
  });
});
