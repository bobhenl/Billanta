import { describe, expect, it } from "vitest";
import { autoPublishDecision, WEEKLY_AUTOPUBLISH_LIMIT } from "./blog-autopublish";

const post = {
  title: "Jak spočítat splatnost faktury",
  description: "Kalkulačka splatnosti spočítá datum a upozorní na víkend nebo svátek.",
  body: "Splatnost se počítá v kalendářních dnech od data vystavení.",
};
const ok = { kind: "tool_howto" as const, enabled: true, warnings: [], post, publishedThisWeek: 0 };

describe("autoPublishDecision", () => {
  it("publishes a clean post of a switched-on kind under the weekly cap", () => {
    expect(autoPublishDecision(ok)).toEqual({ publish: true });
    expect(autoPublishDecision({ ...ok, kind: "trade_invoicing", publishedThisWeek: WEEKLY_AUTOPUBLISH_LIMIT - 1 })).toEqual({ publish: true });
  });

  it("never publishes tax deadline posts, even with a switch left on", () => {
    expect(autoPublishDecision({ ...ok, kind: "tax_deadlines" })).toEqual({ publish: false, reason: "kind_not_auto" });
  });

  it("never publishes briefs or hand-written posts", () => {
    expect(autoPublishDecision({ ...ok, kind: "brief" })).toEqual({ publish: false, reason: "kind_not_auto" });
    expect(autoPublishDecision({ ...ok, kind: "manual" })).toEqual({ publish: false, reason: "kind_not_auto" });
  });

  it("respects the switch", () => {
    expect(autoPublishDecision({ ...ok, enabled: false })).toEqual({ publish: false, reason: "switched_off" });
  });

  it("never publishes a post with a failed check", () => {
    expect(autoPublishDecision({ ...ok, warnings: ["unknown_number"] })).toEqual({ publish: false, reason: "has_warnings" });
  });

  it("keeps posts about a changing law for a person", () => {
    const novela = { ...post, body: `${post.body} Od ledna platí novela zákona o DPH.` };
    expect(autoPublishDecision({ ...ok, post: novela })).toEqual({ publish: false, reason: "legislative" });
  });

  it("stops at the weekly cap", () => {
    expect(autoPublishDecision({ ...ok, publishedThisWeek: WEEKLY_AUTOPUBLISH_LIMIT })).toEqual({ publish: false, reason: "weekly_limit" });
  });
});
