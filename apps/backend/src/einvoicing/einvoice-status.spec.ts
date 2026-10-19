import { describe, expect, it } from "vitest";
import { applyStatusUpdate, isOutgoingStatus, type OutgoingState } from "./einvoice-status";

const t0 = new Date("2027-01-04T10:00:00Z");
const t1 = new Date("2027-01-04T10:05:00Z");
const state = (s: Partial<OutgoingState> = {}): OutgoingState => ({ status: "sent", sentAt: t0, deliveredAt: null, reportedAt: null, ...s });

describe("applyStatusUpdate", () => {
  it("moves forward and stamps the step", () => {
    expect(applyStatusUpdate(state(), { status: "delivered", occurredAt: t1 })).toEqual({ status: "delivered", statusReason: null, deliveredAt: t1 });
  });

  it("does not move back on a late webhook, but still records the step", () => {
    const patch = applyStatusUpdate(state({ status: "reported", reportedAt: t0 }), { status: "delivered", occurredAt: t1 });
    expect(patch).toEqual({ deliveredAt: t1 });
  });

  it("ignores duplicates", () => {
    expect(applyStatusUpdate(state({ status: "delivered", deliveredAt: t0 }), { status: "delivered", occurredAt: t1 })).toEqual({});
  });

  it("lets the buyer reject after delivery, with the reason", () => {
    expect(applyStatusUpdate(state({ status: "delivered", deliveredAt: t0 }), { status: "rejected", reason: "wrong_po", occurredAt: t1 })).toEqual({
      status: "rejected",
      statusReason: "wrong_po",
    });
  });

  it("ignores a technical failure after delivery", () => {
    expect(applyStatusUpdate(state({ status: "delivered", deliveredAt: t0 }), { status: "failed", occurredAt: t1 })).toEqual({});
  });

  it("never leaves a terminal state", () => {
    expect(applyStatusUpdate(state({ status: "rejected" }), { status: "delivered", occurredAt: t1 })).toEqual({});
  });

  it("implies sent when a later step arrives first", () => {
    const patch = applyStatusUpdate(state({ status: "queued", sentAt: null }), { status: "delivered", occurredAt: t1 });
    expect(patch).toMatchObject({ status: "delivered", sentAt: t1, deliveredAt: t1 });
  });
});

describe("isOutgoingStatus", () => {
  it("accepts only known statuses", () => {
    expect(isOutgoingStatus("delivered")).toBe(true);
    expect(isOutgoingStatus("paid")).toBe(false);
    expect(isOutgoingStatus(3)).toBe(false);
  });
});
