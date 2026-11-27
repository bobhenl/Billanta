import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { sealedMaxLength } from "@faktur/cz-compliance";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanSummary } from "../billing/plan.guard";
import { assertSealingAllowed, rekeyWrites, sealingAllowed, assertServerReadable, plainOrNull, redactSealedInvoice, redactSealedItem, sealableText, SEALED_PLACEHOLDER, textFilterVerdict } from "./sealed";

vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: vi.fn() }));

// A well-formed envelope: 16 base64 chars of IV, then ciphertext.
const envelope = (ctLength: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(ctLength)}`;

describe("assertServerReadable", () => {
  it("lets plain text through and refuses an envelope", () => {
    expect(() => assertServerReadable("Konzultace", null, undefined)).not.toThrow();
    expect(() => assertServerReadable("Konzultace", envelope(24))).toThrow(ConflictException);
  });

  it("does not mistake text that only starts like an envelope", () => {
    expect(() => assertServerReadable("enc:v1: poznámka")).not.toThrow();
  });
});

describe("sealableText", () => {
  const schema = sealableText(10);

  it("keeps the plain limit for plain text", () => {
    expect(schema.safeParse("a".repeat(10)).success).toBe(true);
    expect(schema.safeParse("a".repeat(11)).success).toBe(false);
  });

  it("accepts an envelope longer than the plain limit, up to what that limit can seal to", () => {
    const max = sealedMaxLength(10);
    const fits = envelope(max - "enc:v1:AAAAAAAAAAAAAAAA:".length);
    expect(fits.length).toBe(max);
    expect(schema.safeParse(fits).success).toBe(true);
    expect(schema.safeParse(fits + "QQQQ").success).toBe(false);
  });
});

describe("redaction", () => {
  it("replaces only the encrypted fields", () => {
    const invoice = redactSealedInvoice({ noteAbove: envelope(24), noteBelow: "Děkujeme", internalNote: null });
    expect(invoice).toEqual({ noteAbove: SEALED_PLACEHOLDER, noteBelow: "Děkujeme", internalNote: null });
    expect(redactSealedItem({ description: envelope(24), qty: 1 })).toEqual({ description: SEALED_PLACEHOLDER, qty: 1 });
    expect(redactSealedItem({ description: "Práce" })).toEqual({ description: "Práce" });
  });

  it("hides envelopes from search", () => {
    expect(plainOrNull(envelope(24))).toBeNull();
    expect(plainOrNull("Práce")).toBe("Práce");
  });
});

describe("sealing on a plan without confidential mode", () => {
  const start = { plan: "start" as const, enforced: true };
  const sealed = envelope(24);
  const other = envelope(28);

  it("lets plain saves through on any plan", () => {
    expect(sealingAllowed(start, ["Konzultace", null], [])).toBe(true);
  });

  it("refuses new ciphertext in a plain document", () => {
    expect(sealingAllowed(start, ["Konzultace", sealed], ["Konzultace"])).toBe(false);
  });

  it("keeps a document sealed after a downgrade, even with freshly sealed text", () => {
    expect(sealingAllowed(start, [other], [sealed])).toBe(true);
  });

  it("allows sealing on Plus, and when plans are not enforced", () => {
    expect(sealingAllowed({ plan: "plus", enforced: true }, [sealed], [])).toBe(true);
    expect(sealingAllowed({ plan: "start", enforced: false }, [sealed], [])).toBe(true);
    expect(sealingAllowed(null, [sealed], [])).toBe(true);
  });
});

describe("assertSealingAllowed", () => {
  const db = {} as never;
  const plan = vi.mocked(loadPlanSummary);
  beforeEach(() => plan.mockReset());

  it("answers 403 plan_required with the feature and the plan to buy", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    const error = await assertSealingAllowed(db, "t1", [envelope(24)]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ error: "plan_required", feature: "confidential_mode", plan: "plus" });
  });

  it("reads the stored texts only when the plan would refuse", async () => {
    const stored = vi.fn(() => [envelope(24)]);
    plan.mockResolvedValue({ plan: "business", enforced: true } as never);
    await assertSealingAllowed(db, "t1", [envelope(28)], stored);
    expect(stored).not.toHaveBeenCalled();
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    await expect(assertSealingAllowed(db, "t1", [envelope(28)], stored)).resolves.toBeUndefined();
    expect(stored).toHaveBeenCalledOnce();
  });

  it("skips the plan lookup for a plain save", async () => {
    await assertSealingAllowed(db, "t1", ["Konzultace"]);
    expect(plan).not.toHaveBeenCalled();
  });
});

describe("rekeyWrites", () => {
  const wrapA = `BBBBBBBBBBBBBBBB:${"A".repeat(64)}`;
  const wrapB = `CCCCCCCCCCCCCCCC:${"B".repeat(64)}`;
  const docEnvelope = (wrap: string) => `${envelope(24)}:${wrap}`;

  it("lets ciphertext replace ciphertext under one document key", () => {
    expect(() => rekeyWrites([{ incoming: docEnvelope(wrapA), stored: envelope(24) }, { incoming: docEnvelope(wrapA), stored: docEnvelope(wrapB) }])).not.toThrow();
  });

  it("refuses to seal plain text this way (that goes through Zašifrovat and its plan check)", () => {
    expect(() => rekeyWrites([{ incoming: docEnvelope(wrapA), stored: "Konzultace" }])).toThrow(ConflictException);
    expect(() => rekeyWrites([{ incoming: docEnvelope(wrapA), stored: null }])).toThrow(ConflictException);
  });

  it("refuses two document keys, or an envelope without one", () => {
    expect(() => rekeyWrites([{ incoming: docEnvelope(wrapA), stored: envelope(24) }, { incoming: docEnvelope(wrapB), stored: envelope(24) }])).toThrow(BadRequestException);
    expect(() => rekeyWrites([{ incoming: envelope(24), stored: envelope(24) }])).toThrow(BadRequestException);
  });
});

describe("textFilterVerdict", () => {
  it("matches on a plain hit, with or without ciphertext beside it", () => {
    expect(textFilterVerdict(true, ["Konzultace"], false)).toBe("match");
    expect(textFilterVerdict(true, [envelope(24)], true)).toBe("match");
  });

  it("leaves a document with ciphertext to the browser only when asked to", () => {
    expect(textFilterVerdict(false, ["Konzultace", envelope(24)], true)).toBe("pending");
    expect(textFilterVerdict(false, ["Konzultace", envelope(24)], false)).toBe("miss");
  });

  it("never counts plain text or a look-alike as something to check", () => {
    expect(textFilterVerdict(false, ["Konzultace", null, "enc:v1: poznámka"], true)).toBe("miss");
  });
});
