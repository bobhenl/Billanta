import { describe, expect, it } from "vitest";
import { type BankAccountRow, pickBankAccount } from "./bank-accounts";

const acc = (id: string, currency: string | null): BankAccountRow => ({
  id,
  tenantId: "t",
  label: id,
  accountNumber: null,
  bankCode: null,
  iban: `CZ00${id}`,
  swift: null,
  currency,
  sortOrder: 0,
  createdAt: new Date(),
});

describe("pickBankAccount", () => {
  const accounts = [acc("eur", "EUR"), acc("other", null)];
  it("prefers the account chosen on the invoice", () => {
    expect(pickBankAccount(accounts, { bankAccountId: "other", currency: "EUR" })?.id).toBe("other");
  });
  it("falls back to an account in the invoice currency", () => {
    expect(pickBankAccount(accounts, { bankAccountId: null, currency: "EUR" })?.id).toBe("eur");
  });
  it("returns null (= primary account) when nothing matches", () => {
    expect(pickBankAccount(accounts, { bankAccountId: null, currency: "CZK" })).toBeNull();
    expect(pickBankAccount(accounts, { bankAccountId: "deleted", currency: "CZK" })).toBeNull();
  });
});
