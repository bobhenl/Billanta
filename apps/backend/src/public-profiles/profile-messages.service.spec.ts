import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { parseProfileMessage, ProfileMessagesService } from "./profile-messages.service";

const body = (over: Record<string, unknown> = {}) => ({ name: "Jana Nová", email: "Jana@Example.cz", message: "Dobrý den, máte volno v březnu?", ...over });

function setup(target: string | null = "t-1") {
  const notifications = { notify: vi.fn() };
  const profiles = { findBySlug: vi.fn(async () => ({ services: [{ id: "web001", title: "Web na míru" }] })) };
  const svc = new ProfileMessagesService({} as never, profiles as never, notifications as never);
  vi.spyOn(svc, "target").mockResolvedValue(target);
  return { svc, notifications, profiles };
}

describe("parseProfileMessage", () => {
  it("accepts a normal message and lowercases the e-mail", () => {
    expect(parseProfileMessage(body())).toMatchObject({ kind: "message", message: { name: "Jana Nová", email: "jana@example.cz", serviceId: null } });
  });

  it("rejects bad e-mails, oversized texts and unknown keys; a filled honeypot is a bot", () => {
    for (const bad of [body({ email: "nope" }), body({ message: "x".repeat(2001) }), body({ name: "x".repeat(121) }), body({ message: "ok" }), body({ extra: 1 }), body({ serviceId: "../x" })]) {
      expect(parseProfileMessage(bad).kind).toBe("invalid");
    }
    expect(parseProfileMessage(body({ website: "http://spam" })).kind).toBe("bot");
  });
});

describe("ProfileMessagesService.submit", () => {
  it("notifies the members in-app with the sender and the service asked about", async () => {
    const t = setup();
    await t.svc.submit("novak", body({ serviceId: "web001" }));
    expect(t.notifications.notify).toHaveBeenCalledWith("t-1", "profile_message", {
      title: "Zpráva z profilu: Jana Nová (Web na míru)",
      body: "Od: Jana Nová <jana@example.cz>\n\nDobrý den, máte volno v březnu?",
      link: null,
    });
  });

  it("validates first, is a 404 when the form is off, and stays quiet for bots", async () => {
    const t = setup();
    await expect(t.svc.submit("novak", body({ email: "" }))).rejects.toBeInstanceOf(BadRequestException);
    expect(t.svc.target).not.toHaveBeenCalled();
    await expect(setup(null).svc.submit("novak", body())).rejects.toBeInstanceOf(NotFoundException);
    await t.svc.submit("novak", body({ website: "x" }));
    expect(t.notifications.notify).not.toHaveBeenCalled();
  });

  it("caps messages per company per day", async () => {
    const t = setup();
    for (let i = 0; i < 30; i++) await t.svc.submit("novak", body());
    const err = await t.svc.submit("novak", body()).catch((e: unknown) => e);
    expect((err as HttpException).getStatus()).toBe(429);
    expect(t.notifications.notify).toHaveBeenCalledTimes(30);
  });
});
