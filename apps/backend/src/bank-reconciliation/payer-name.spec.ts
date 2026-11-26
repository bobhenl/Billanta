import { describe, expect, it } from "vitest";
import { payerName } from "./payer-name";

describe("payerName", () => {
  it("takes the payer of a cleared foreign payment from the message", () => {
    expect(payerName("Česká spořitelna vyp", "/ROC/281475579858280///URI/Tebex Li mited")).toBe("Tebex Li mited");
    expect(payerName("ZPS PZSUN 1236 (CZK)", "/ROC/1///URI/Acme Ltd/RF/123")).toBe("Acme Ltd");
  });

  it("keeps the counterparty name otherwise", () => {
    expect(payerName("Jan Novák", "Faktura 2026001")).toBe("Jan Novák");
    expect(payerName("Jan Novák", null)).toBe("Jan Novák");
    expect(payerName(null, "/URI/ ")).toBeNull();
  });
});
