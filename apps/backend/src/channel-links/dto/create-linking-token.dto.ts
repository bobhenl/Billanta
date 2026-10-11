import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body for `POST /api/v1/channel-links` (dashboard-user-initiated: "generate
 * a link code for me to send to the bot"). Distinct from
 * `VerifyChannelLinkDto`, which is the AI microservice's per-message lookup
 * — see that DTO's doc comment for the full flow.
 */
export const createLinkingTokenSchema = z.object({
  channel: z.enum(["telegram", "whatsapp"]),
});

export class CreateLinkingTokenDto extends createZodDto(createLinkingTokenSchema) {}
