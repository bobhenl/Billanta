import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { OutgoingEInvoiceStatus } from "../../drizzle/schema";
import {
  WebhookSignatureError,
  type DeliveryStatusUpdate,
  type EInvoiceProvider,
  type RegisterParticipantInput,
  type RegisterParticipantResult,
  type SendDocumentInput,
  type SendDocumentResult,
  type WebhookEvent,
  type WebhookRequest,
} from "./einvoice-provider";
import { isOutgoingStatus } from "./einvoice-status";

export const FAKE_SIGNATURE_HEADER = "x-fake-einvoice-signature";

/** HMAC-SHA256 of the raw body, hex. Real providers sign differently; this only has to be safe for dev. */
export function signFakeWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

const PARTICIPANT = /^\d{4}:[0-9A-Za-z]{2,50}$/;

/**
 * Sandbox stand-in for a certified provider, for local development and tests.
 * Nothing leaves the process: registrations succeed at once, sends get a
 * made-up message ID, and statuses move only when a (signed) webhook says so.
 * Receivers whose ID ends in "0000000000" are rejected, so the error path can
 * be tried without a real network.
 */
export class FakeEInvoiceProvider implements EInvoiceProvider {
  readonly key = "fake";
  private readonly statuses = new Map<string, DeliveryStatusUpdate>();

  constructor(private readonly webhookSecret: string | undefined) {}

  async registerParticipant(input: RegisterParticipantInput): Promise<RegisterParticipantResult> {
    if (!PARTICIPANT.test(input.participantId)) return { status: "failed", error: "invalid_participant_id" };
    return { status: "registered", providerRef: `fake-participant-${input.participantId}` };
  }

  async sendDocument(input: SendDocumentInput): Promise<SendDocumentResult> {
    const messageId = `fake-${randomUUID()}`;
    const rejected = input.receiverParticipantId.endsWith("0000000000");
    const status: OutgoingEInvoiceStatus = rejected ? "rejected" : "sent";
    const reason = rejected ? "receiver_not_found" : undefined;
    this.statuses.set(messageId, { messageId, status, reason, occurredAt: new Date() });
    return { messageId, status, reason };
  }

  async getStatus(messageId: string): Promise<DeliveryStatusUpdate> {
    return this.statuses.get(messageId) ?? { messageId, status: "failed", reason: "unknown_message", occurredAt: new Date() };
  }

  parseWebhook(request: WebhookRequest): WebhookEvent[] {
    // No secret, no webhooks: an unsigned endpoint would let anyone drop
    // documents into a company's inbox.
    if (!this.webhookSecret) throw new WebhookSignatureError("webhook_not_configured");
    const header = request.headers[FAKE_SIGNATURE_HEADER];
    const given = Buffer.from(String(Array.isArray(header) ? header[0] : (header ?? "")), "utf8");
    const expected = Buffer.from(signFakeWebhook(request.rawBody, this.webhookSecret), "utf8");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new WebhookSignatureError("invalid_signature");
    }

    let body: { events?: unknown };
    try {
      body = JSON.parse(request.rawBody) as { events?: unknown };
    } catch {
      throw new WebhookSignatureError("invalid_payload");
    }
    const events = Array.isArray(body.events) ? (body.events as FakeEvent[]) : [];
    return events.flatMap((e): WebhookEvent[] => {
      if (e.kind === "status" && e.messageId && isOutgoingStatus(e.status)) {
        const update = { messageId: e.messageId, status: e.status, reason: e.reason, occurredAt: new Date(e.occurredAt ?? Date.now()) };
        this.statuses.set(e.messageId, update);
        return [{ kind: "status", update }];
      }
      if (e.kind === "incoming" && e.messageId && e.sender && e.receiver && e.xml) {
        return [
          {
            kind: "incoming",
            document: {
              messageId: e.messageId,
              senderParticipantId: e.sender,
              receiverParticipantId: e.receiver,
              xml: e.xml,
              receivedAt: new Date(e.occurredAt ?? Date.now()),
            },
          },
        ];
      }
      return [];
    });
  }
}

interface FakeEvent {
  kind?: string;
  messageId?: string;
  status?: unknown;
  reason?: string;
  occurredAt?: string;
  sender?: string;
  receiver?: string;
  xml?: string;
}
