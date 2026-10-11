import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** `apiKey`: a string sets (after verification), `null` removes, absent leaves it as is. */
export const updateAiSettingsSchema = z.object({
  mode: z.enum(["off", "platform", "own"]).optional(),
  apiKey: z.string().min(20).max(300).nullable().optional(),
});

export class UpdateAiSettingsDto extends createZodDto(updateAiSettingsSchema) {}
