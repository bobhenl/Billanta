import { describe, expect, it } from "vitest";
import { MILESTONE_SQL, MILESTONES, toMilestoneCounts } from "./milestones";

describe("classroom milestones", () => {
  it("selects a column for every milestone", () => {
    for (const m of MILESTONES) expect(MILESTONE_SQL).toContain(`AS ${m}`);
  });

  it("turns postgres counts into numbers", () => {
    const counts = toMilestoneCounts({ invoice_issued: "3", contact_created: "0" });
    expect(counts.invoice_issued).toBe(3);
    expect(counts.contact_created).toBe(0);
    expect(counts.time_logged).toBe(0);
  });
});
