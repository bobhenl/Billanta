import { describe, expect, it } from "vitest";
import { createEInvoiceProvider, einvoicingEnabled } from "./einvoicing-config";

describe("einvoicing config", () => {
  it("is off by default", () => {
    expect(einvoicingEnabled({})).toBe(false);
    expect(einvoicingEnabled({ EINVOICING_ENABLED: "1" })).toBe(false);
    expect(einvoicingEnabled({ EINVOICING_ENABLED: "true" })).toBe(true);
  });

  it("uses the fake outside production only", () => {
    expect(createEInvoiceProvider({}).key).toBe("fake");
    expect(() => createEInvoiceProvider({ NODE_ENV: "production" })).toThrow("einvoicing_fake_provider_in_production");
    expect(() => createEInvoiceProvider({ EINVOICING_PROVIDER: "nope" })).toThrow("einvoicing_unknown_provider");
  });
});
