import { describe, expect, it } from "vitest";
import { WebhookSignatureError } from "./einvoice-provider";
import { FAKE_SIGNATURE_HEADER, FakeEInvoiceProvider, signFakeWebhook } from "./fake-einvoice-provider";

const secret = "test-secret";
const signed = (body: unknown) => {
  const rawBody = JSON.stringify(body);
  return { rawBody, headers: { [FAKE_SIGNATURE_HEADER]: signFakeWebhook(rawBody, secret) } };
};

describe("FakeEInvoiceProvider", () => {
  it("registers well-formed participant IDs only", async () => {
    const p = new FakeEInvoiceProvider(secret);
    expect((await p.registerParticipant({ participantId: "0245:2020123456", legalName: "A", countryCode: "SK" })).status).toBe("registered");
    expect(await p.registerParticipant({ participantId: "2020123456", legalName: "A", countryCode: "SK" })).toEqual({ status: "failed", error: "invalid_participant_id" });
  });

  it("sends, and rejects the magic unknown receiver", async () => {
    const p = new FakeEInvoiceProvider(secret);
    const base = { senderParticipantId: "0245:2020123456", documentType: "invoice" as const, xml: "<Invoice/>", idempotencyKey: "x" };
    const ok = await p.sendDocument({ ...base, receiverParticipantId: "0245:2020999999" });
    expect(ok.status).toBe("sent");
    expect((await p.getStatus(ok.messageId)).status).toBe("sent");
    expect(await p.sendDocument({ ...base, receiverParticipantId: "0245:0000000000" })).toMatchObject({ status: "rejected", reason: "receiver_not_found" });
  });

  it("refuses webhooks without a secret or with a bad signature", () => {
    const body = signed({ events: [] });
    expect(() => new FakeEInvoiceProvider(undefined).parseWebhook(body)).toThrow(new WebhookSignatureError("webhook_not_configured"));
    expect(() => new FakeEInvoiceProvider(secret).parseWebhook({ ...body, headers: { [FAKE_SIGNATURE_HEADER]: "00" } })).toThrow("invalid_signature");
    expect(() => new FakeEInvoiceProvider(secret).parseWebhook({ ...body, rawBody: body.rawBody + " " })).toThrow("invalid_signature");
  });

  it("parses status and incoming events and drops unknown ones", () => {
    const events = new FakeEInvoiceProvider(secret).parseWebhook(
      signed({
        events: [
          { kind: "status", messageId: "m1", status: "delivered", occurredAt: "2027-01-04T10:00:00Z" },
          { kind: "status", messageId: "m2", status: "paid" },
          { kind: "incoming", messageId: "m3", sender: "0245:1", receiver: "0245:2", xml: "<Invoice/>" },
          { kind: "other" },
        ],
      }),
    );
    expect(events.map((e) => e.kind)).toEqual(["status", "incoming"]);
    expect(events[0]).toMatchObject({ update: { messageId: "m1", status: "delivered", occurredAt: new Date("2027-01-04T10:00:00Z") } });
  });
});
