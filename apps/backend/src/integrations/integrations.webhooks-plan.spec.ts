import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ assertPlanFeature: vi.fn() }));
vi.mock("../billing/plan-limits", () => mocks);
vi.mock("./public-url", () => ({ publicUrlProblem: async () => null }));

import { IntegrationsService } from "./integrations.service";
import { addsWebhook, type Webhook } from "./webhooks";

const STORED: Webhook = { id: "6f1c8a52-3d1e-4b7a-9c55-0f2b1a7d9e01", name: "Slack", url: "https://hooks.slack.com/services/x", kind: "slack", events: ["invoice_paid"], enabled: true };
const edit = { id: STORED.id, name: "Slack", url: STORED.url, events: ["invoice_paid" as const], enabled: false };
const added = { name: "Mine", url: "https://example.com/hook", events: ["invoice_paid" as const], enabled: true };

function db() {
  const where = vi.fn(async () => [{ webhooks: [STORED] }]);
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  return { select: () => ({ from: () => ({ where }) }), update };
}

beforeEach(() => {
  mocks.assertPlanFeature.mockReset().mockResolvedValue(undefined);
});

describe("addsWebhook", () => {
  it("is true only for an entry that isn't stored yet", () => {
    expect(addsWebhook([STORED], [edit])).toBe(false);
    expect(addsWebhook([STORED], [])).toBe(false);
    expect(addsWebhook([STORED], [edit, added])).toBe(true);
    expect(addsWebhook([], [{ ...edit }])).toBe(true); // an id we don't have counts as new
  });
});

describe("IntegrationsService.saveWebhooks – plan", () => {
  it("asks for the webhooks plan when a hook is added", async () => {
    const fake = db();
    await new IntegrationsService({} as never).saveWebhooks(fake as never, "t1", "owner", [edit, added]);
    expect(mocks.assertPlanFeature).toHaveBeenCalledWith(fake, "t1", "webhooks");
  });

  it("stores nothing when the plan refuses", async () => {
    const refusal = new ForbiddenException({ error: "plan_required" });
    mocks.assertPlanFeature.mockRejectedValue(refusal);
    const fake = db();
    await expect(new IntegrationsService({} as never).saveWebhooks(fake as never, "t1", "owner", [added])).rejects.toBe(refusal);
    expect(fake.update).not.toHaveBeenCalled();
  });

  it("lets any plan edit or remove the hooks it has", async () => {
    await new IntegrationsService({} as never).saveWebhooks(db() as never, "t1", "owner", [edit]);
    await new IntegrationsService({} as never).saveWebhooks(db() as never, "t1", "owner", []);
    expect(mocks.assertPlanFeature).not.toHaveBeenCalled();
  });
});
