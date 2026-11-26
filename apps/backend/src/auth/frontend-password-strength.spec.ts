import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// The meter under the invite signup's password field (apps/frontend has no
// test runner of its own, so the rules are checked here).
describe("frontend passwordStrength", () => {
  let strength: (password: string) => number;
  beforeAll(async () => {
    // A computed path keeps the frontend file out of the backend's tsc program.
    const file = join(__dirname, "../../../frontend/lib/password-strength.ts");
    strength = ((await import(file)) as { passwordStrength: typeof strength }).passwordStrength;
  });

  it("scores length and variety, and punishes common words and runs", () => {
    expect(strength("")).toBe(0);
    expect(strength("Ab1!xyz")).toBe(0); // under 8
    expect(strength("kvetinac")).toBe(0); // 8, one class
    expect(strength("kvetinac7")).toBe(1);
    expect(strength("Kvetinac7")).toBe(2);
    expect(strength("Kvetinac7Zluty")).toBe(3);
    expect(strength("Kvetinac7Zluty!Mrak")).toBe(4);
    expect(strength("Heslo123Zluty!Mrak")).toBe(2); // common word
    expect(strength("Kvetinac7Zluty!1234")).toBe(3); // run
    expect(strength("Kvetinac7Zluty!aaaa")).toBe(3); // repeat
  });
});
