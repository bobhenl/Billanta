import { describe, expect, it } from "vitest";
import { createBackupDestinationSchema } from "./create-backup-destination.dto";

describe("createBackupDestinationSchema", () => {
  it("accepts a webhook destination with a URL", () => {
    const result = createBackupDestinationSchema.safeParse({
      type: "webhook",
      webhookUrl: "https://example.com/hook",
      schedule: "daily",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a webhook destination with no URL", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "webhook", schedule: "daily" });
    expect(result.success).toBe(false);
  });

  it("accepts a 'local' destination with schedule 'manual'", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "local", schedule: "manual" });
    expect(result.success).toBe(true);
  });

  it("rejects a 'local' destination with schedule 'daily'", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "local", schedule: "daily" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["schedule"]);
      expect(result.error.issues[0]?.message).toMatch(/schedule 'manual'/);
    }
  });

  it("rejects a 'local' destination with schedule 'weekly'", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "local", schedule: "weekly" });
    expect(result.success).toBe(false);
  });

  it("rejects a 'local' destination that omits schedule (defaults to 'weekly', still disallowed)", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "local" });
    expect(result.success).toBe(false);
  });

  it("does not require webhookUrl for a 'local' destination", () => {
    const result = createBackupDestinationSchema.safeParse({ type: "local", schedule: "manual" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.webhookUrl).toBeUndefined();
    }
  });
});
