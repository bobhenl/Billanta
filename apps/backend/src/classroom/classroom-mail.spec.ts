import { describe, expect, it } from "vitest";
import { approvedMail, dueReminder, endingMail, inviteMail, rejectedMail } from "./classroom-mail";

describe("classroom mail", () => {
  const end = new Date("2027-08-31T21:59:59Z");

  it("sends the 30-day reminder once, then the 7-day one", () => {
    expect(dueReminder(end, new Date("2027-07-15T08:00:00Z"), null)).toBeNull();
    expect(dueReminder(end, new Date("2027-08-05T08:00:00Z"), null)).toBe(30);
    expect(dueReminder(end, new Date("2027-08-06T08:00:00Z"), 30)).toBeNull();
    expect(dueReminder(end, new Date("2027-08-26T08:00:00Z"), 30)).toBe(7);
    expect(dueReminder(end, new Date("2027-08-27T08:00:00Z"), 7)).toBeNull();
    // A class created a week before its end gets only the last one.
    expect(dueReminder(end, new Date("2027-08-26T08:00:00Z"), null)).toBe(7);
    expect(dueReminder(end, new Date("2027-09-01T08:00:00Z"), null)).toBeNull();
  });

  it("links to the class in the teacher's language", () => {
    const mail = endingMail("sk", "https://billanta.cz", "4.A", "abc", 7, end);
    expect(mail.title).toBe("Trieda 4.A končí o 7 dní");
    expect(mail.body).toContain("https://billanta.cz/sk/classroom/abc");
  });

  it("never uses the long dash", () => {
    for (const lang of ["cs", "sk", "en"] as const) {
      const all = [
        endingMail(lang, "x", "4.A", "id", 30, end),
        inviteMail(lang, "x", "J. Novák", "OA"),
        approvedMail(lang, "x"),
        rejectedMail(lang, "note"),
      ];
      for (const m of all) expect(`${m.title}${m.body}`).not.toContain("—");
    }
  });
});
