import type { OutgoingEInvoiceStatus } from "../../drizzle/schema";

export const OUTGOING_STATUSES = ["queued", "sent", "delivered", "reported", "rejected", "failed"] as const satisfies readonly OutgoingEInvoiceStatus[];

export const isOutgoingStatus = (value: unknown): value is OutgoingEInvoiceStatus =>
  typeof value === "string" && (OUTGOING_STATUSES as readonly string[]).includes(value);

const RANK: Record<OutgoingEInvoiceStatus, number> = { queued: 0, sent: 1, delivered: 2, reported: 3, rejected: 4, failed: 4 };
const TERMINAL = new Set<OutgoingEInvoiceStatus>(["rejected", "failed"]);

export interface OutgoingState {
  status: OutgoingEInvoiceStatus;
  sentAt: Date | null;
  deliveredAt: Date | null;
  reportedAt: Date | null;
}

export interface StatusPatch {
  status?: OutgoingEInvoiceStatus;
  statusReason?: string | null;
  sentAt?: Date;
  deliveredAt?: Date;
  reportedAt?: Date;
}

/**
 * What a provider status update changes on an outgoing e-invoice.
 *
 * Webhooks arrive late, twice and out of order, so the status only moves
 * forward. Delivery to the buyer and the report to FR SR are separate steps
 * in the 5-corner model and can come in either order, so each keeps its own
 * timestamp even when the status itself does not move. A buyer may still
 * reject a document that was delivered or reported; a technical failure
 * after delivery is noise and is ignored. Rejected and failed are final:
 * the fix is a new transmission (or a credit note), not a status change.
 */
export function applyStatusUpdate(current: OutgoingState, update: { status: OutgoingEInvoiceStatus; reason?: string; occurredAt: Date }): StatusPatch {
  if (TERMINAL.has(current.status)) return {};
  const patch: StatusPatch = {};
  const at = update.occurredAt;
  if (update.status === "sent" && !current.sentAt) patch.sentAt = at;
  if (update.status === "delivered" && !current.deliveredAt) patch.deliveredAt = at;
  if (update.status === "reported" && !current.reportedAt) patch.reportedAt = at;

  if (update.status === "failed" && RANK[current.status] >= RANK.delivered) return patch;
  if (RANK[update.status] > RANK[current.status]) {
    patch.status = update.status;
    patch.statusReason = TERMINAL.has(update.status) ? (update.reason ?? null) : null;
    // A later step implies the earlier ones happened.
    if (!current.sentAt && RANK[update.status] >= RANK.sent && !TERMINAL.has(update.status)) patch.sentAt ??= at;
  }
  return patch;
}
