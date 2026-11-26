import { describe, expect, it } from "vitest";
import { seatRefusal } from "./seats";

describe("seatRefusal", () => {
  it("lets Free and Start have only the owner, and points to Plus", () => {
    expect(seatRefusal("free", ["owner"], "viewer")).toEqual({ pool: "members", limit: 1, plan: "plus" });
    expect(seatRefusal("start", ["owner"], "admin")).toEqual({ pool: "members", limit: 1, plan: "plus" });
  });

  it("counts pending invitations, so inviting past the limit one by one fails", () => {
    expect(seatRefusal("plus", ["owner", "viewer"], "viewer")).toBeNull();
    expect(seatRefusal("plus", ["owner", "viewer", "admin"], "viewer")).toEqual({ pool: "members", limit: 3, plan: "business" });
  });

  it("keeps accountants out of the member count but caps them on their own", () => {
    expect(seatRefusal("start", ["owner"], "accountant")).toBeNull();
    expect(seatRefusal("plus", ["owner", "accountant", "accountant", "viewer"], "viewer")).toBeNull();
    expect(seatRefusal("business", ["owner", "accountant", "accountant"], "accountant")).toEqual({ pool: "accountants", limit: 2, plan: null });
  });

  it("has no bigger plan to offer past Firma", () => {
    expect(seatRefusal("business", Array(10).fill("viewer"), "viewer")).toEqual({ pool: "members", limit: 10, plan: null });
  });
});
