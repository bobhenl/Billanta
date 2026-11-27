import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/** Body for `PATCH /api/v1/contacts/:id/visibility`: who the client belongs to and whether others see it. */
export const contactVisibilitySchema = z
  .object({
    // A member of this company, or null for nobody in particular.
    ownerUserId: z.string().uuid().nullable().optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine((v) => v.ownerUserId !== undefined || v.isPrivate !== undefined, { message: "nothing_to_change" });

export class ContactVisibilityDto extends createZodDto(contactVisibilitySchema) {}
