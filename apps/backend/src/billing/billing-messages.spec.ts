import { describe, expect, it } from "vitest";
import { prepaidReminderMessage } from "./billing-messages";

const proforma = {
  number: "ZF2026-0042",
  months: 12,
  totalMinor: 381876,
  variableSymbol: "2026000042",
  dueDate: "2026-11-01",
  account: "19-2000145399/0800",
  iban: "CZ6508000000192000145399",
};

describe("prepaidReminderMessage", () => {
  it("names the proforma and links to billing, in the company's language", () => {
    const cs = prepaidReminderMessage("cs", "plus", "2026-11-01", 14, proforma);
    const sk = prepaidReminderMessage("sk", "plus", "2026-11-01", 14, proforma);
    const en = prepaidReminderMessage("en", "plus", "2026-11-01", 14, proforma);
    expect([cs.lang, sk.lang, en.lang]).toEqual(["cs", "sk", "en"]);
    for (const m of [cs, sk, en]) {
      expect(m.notice.link).toBe("/billing");
      expect(m.notice.body).toContain("ZF2026-0042");
    }
    expect(sk.notice.body).not.toBe(cs.notice.body);
  });

  it("carries the payment details the QR code encodes", () => {
    const values = prepaidReminderMessage("cs", "plus", "2026-11-01", 3, proforma).details.map((d) => d.value);
    expect(values).toContain("2026000042");
    expect(values).toContain("19-2000145399/0800");
    expect(values.some((v) => v.replace(/\s/g, "").includes("3818,76"))).toBe(true);
  });

  it("falls back to Czech for an unknown locale", () => {
    expect(prepaidReminderMessage(null, "start", "2026-11-01", 3, proforma).lang).toBe("cs");
  });
});
