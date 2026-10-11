import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body for `POST /api/v1/channel-links/verify` (blueprint §6 step 2).
 *
 * Matches the shape already sent by the real, implemented caller —
 * `apps/ai-service/app/pipeline/voice_to_invoice.py::resolve_tenant()`:
 *
 *     POST /api/v1/channel-links/verify
 *     Authorization: Bearer <BACKEND_SERVICE_JWT>
 *     { "channel": "telegram" | "whatsapp", "external_user_id": "<id>" }
 *
 * Note this is a *lookup*, not the account-linking activation step: by the
 * time the AI service calls this, a dashboard user has already generated a
 * linking token/deep-link and the recipient has already sent it once
 * (blueprint §6 step 2) to activate the `channel_links` row out-of-band.
 * This endpoint just answers "is this external_user_id linked and active,
 * and if so, to which tenant?" on every subsequent inbound message.
 * `resolve_tenant()` treats HTTP 404 as "not linked" and stops processing
 * (never processes an unlinked sender); any 2xx response is expected to
 * include a `tenant_id` field in the JSON body.
 *
 * The separate "generate/activate a linking token" flow (dashboard-user-
 * initiated) is a different endpoint — see
 * `ChannelLinksController.createLinkingToken`, still a TODO stub here.
 */
export const verifyChannelLinkSchema = z.object({
  channel: z.enum(["telegram", "whatsapp"]),
  external_user_id: z.string().min(1),
});

export class VerifyChannelLinkDto extends createZodDto(verifyChannelLinkSchema) {}
