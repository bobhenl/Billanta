import type { EInvoiceDocumentType, OutgoingEInvoiceStatus } from "../../drizzle/schema";

/**
 * What Billanta needs from a certified Peppol provider ("digitálny poštár").
 * The provider runs the access point, the SMP registration and the report to
 * FR SR; we generate the UBL ourselves and keep the archive. Kept this small
 * on purpose so that switching providers means one new class, not a new flow.
 * No provider is chosen yet (docs/sk-peppol-providers.md).
 */
export interface EInvoiceProvider {
  /** Stable key stored in the `provider` columns, e.g. "fake". */
  readonly key: string;

  /**
   * Registers a company as a receiving and sending participant
   * (`0245:<DIČ>` for SK) in the provider's SMP. May finish asynchronously:
   * `pending` now, `registered` later through a webhook or `getStatus`.
   */
  registerParticipant(input: RegisterParticipantInput): Promise<RegisterParticipantResult>;

  /** Hands one UBL document to the provider for delivery and reporting. */
  sendDocument(input: SendDocumentInput): Promise<SendDocumentResult>;

  /** Polls the delivery status, for providers or moments without a webhook. */
  getStatus(messageId: string): Promise<DeliveryStatusUpdate>;

  /**
   * Verifies and parses a webhook call. Must reject anything whose signature
   * does not check out: the caller trusts the result to pick a tenant.
   */
  parseWebhook(request: WebhookRequest): WebhookEvent[];
}

export interface RegisterParticipantInput {
  participantId: string;
  legalName: string;
  countryCode: string;
  /** IČO, which providers use for their own KYC. */
  companyId?: string | null;
}

export interface RegisterParticipantResult {
  status: "pending" | "registered" | "failed";
  providerRef?: string;
  error?: string;
}

export interface SendDocumentInput {
  senderParticipantId: string;
  receiverParticipantId: string;
  documentType: EInvoiceDocumentType;
  xml: string;
  /** Our outgoing_einvoices.id, sent as the idempotency key where the provider supports one. */
  idempotencyKey: string;
}

export interface SendDocumentResult {
  messageId: string;
  status: OutgoingEInvoiceStatus;
  reason?: string;
}

export interface DeliveryStatusUpdate {
  messageId: string;
  status: OutgoingEInvoiceStatus;
  reason?: string;
  occurredAt: Date;
}

export interface IncomingDocument {
  messageId: string;
  senderParticipantId: string;
  receiverParticipantId: string;
  xml: string;
  receivedAt: Date;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}

export type WebhookEvent =
  | { kind: "status"; update: DeliveryStatusUpdate }
  | { kind: "incoming"; document: IncomingDocument }
  | { kind: "participant"; participantId: string; status: "registered" | "failed"; error?: string };

export class WebhookSignatureError extends Error {}
