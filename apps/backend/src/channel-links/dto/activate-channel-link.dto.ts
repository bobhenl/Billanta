import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body for `POST /api/v1/internal/channel-links/activate`, sent by the AI
 * microservice when a sender opens the bot with `/start <linking_token>`.
 */
export const activateChannelLinkSchema = z.object({
  channel: z.enum(["telegram", "whatsapp"]),
  linking_token: z.string().min(16).max(128),
  external_user_id: z.string().min(1).max(64),
  display_name: z.string().max(120).optional(),
});

export class ActivateChannelLinkDto extends createZodDto(activateChannelLinkSchema) {}
