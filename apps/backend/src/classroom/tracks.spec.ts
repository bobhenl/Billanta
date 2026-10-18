import { describe, expect, it } from "vitest";
import { classKinds, classModules, suggestedTrack, trackKinds, trackModules } from "./tracks";

describe("classroom tracks", () => {
  it("suggests a track from the school level", () => {
    expect(suggestedTrack("zs")).toBe("basic");
    expect(suggestedTrack("ss")).toBe("standard");
    expect(suggestedTrack("vs")).toBe("advanced");
  });

  it("keeps basic classes without VAT", () => {
    expect(trackKinds("basic", "CZ")).toEqual(["cz_freelancer", "cz_pausal"]);
    expect(trackModules("basic").bank).toBe(false);
  });

  it("starts Slovak standard classes with the Slovak company", () => {
    expect(trackKinds("standard", "SK")[0]).toBe("sk_vat_sro");
  });

  it("never turns AI on", () => {
    expect(trackModules("advanced").ai).toBe(false);
    expect(classModules("advanced", { ai: true, time: false })).toMatchObject({ ai: false, time: false, bank: true });
  });

  it("keeps only known kinds and falls back to the track", () => {
    expect(classKinds("advanced", "CZ", ["cz_pausal", "evil"])).toEqual(["cz_pausal"]);
    expect(classKinds("basic", "CZ", ["evil"])).toEqual(["cz_freelancer", "cz_pausal"]);
    expect(classKinds("basic", "CZ", undefined)).toEqual(["cz_freelancer", "cz_pausal"]);
  });
});
