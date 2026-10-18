import { describe, expect, it } from "vitest";
import { BankTransferDto } from "./subscription.controller";

describe("BankTransferDto", () => {
  it("is a year when months is left out, as before monthly transfers", () => {
    expect(BankTransferDto.schema.parse({ plan: "plus" })).toEqual({ plan: "plus", months: 12 });
    expect(BankTransferDto.schema.parse({ plan: "start", months: 1 })).toEqual({ plan: "start", months: 1 });
  });

  it("takes only what platform_proformas allows", () => {
    expect(BankTransferDto.schema.safeParse({ plan: "plus", months: 3 }).success).toBe(false);
    expect(BankTransferDto.schema.safeParse({ plan: "plus", months: "12" }).success).toBe(false);
  });
});
