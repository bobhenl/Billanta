import { describe, expect, it } from "vitest";
import { moneyTotals, moneyVatSummary } from "./exports.service";

describe("Money S3 totals", () => {
  it("puts the reduced rate in the 5 slots and the standard one in 22", () => {
    const xml = moneyVatSummary([
      { vatRatePercent: 0, totalWithoutVat: 50, vatAmount: 0 },
      { vatRatePercent: 12, totalWithoutVat: 100, vatAmount: 12 },
      { vatRatePercent: 21, totalWithoutVat: 200, vatAmount: 42 },
    ]);
    expect(xml).toBe(
      "<SouhrnDPH><Zaklad0>50.00</Zaklad0><Zaklad5>100.00</Zaklad5><Zaklad22>200.00</Zaklad22>" +
        "<DPH5>12.00</DPH5><DPH22>42.00</DPH22></SouhrnDPH>",
    );
  });

  it("writes CZK totals plainly", () => {
    const xml = moneyTotals("CZK", null, [{ vatRatePercent: 21, totalWithoutVat: 100, vatAmount: 21 }], 121);
    expect(xml.startsWith("<SouhrnDPH>")).toBe(true);
    expect(xml.endsWith("<Celkem>121.00</Celkem>")).toBe(true);
  });

  it("wraps a foreign currency in Valuty with the stored rate", () => {
    const xml = moneyTotals("EUR", "25.125000", [{ vatRatePercent: 0, totalWithoutVat: 10, vatAmount: 0 }], 10);
    expect(xml).toMatch(/^<Valuty><Mena><Kod>EUR<\/Kod><Mnozstvi>1<\/Mnozstvi><Kurs>25\.125<\/Kurs><\/Mena><SouhrnDPH>/);
    expect(xml.endsWith("<Celkem>10.00</Celkem></Valuty>")).toBe(true);
  });

  it("omits Kurs when no rate is stored", () => {
    expect(moneyTotals("EUR", null, [], 0)).not.toContain("<Kurs>");
  });
});
