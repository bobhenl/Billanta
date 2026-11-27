import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ACCESS_LOCK_LEVELS } from "../../tenancy/visibility";

/** Body for `PATCH /api/v1/contacts/:id/visibility`: who the client belongs to and who else sees it. */
export const contactVisibilitySchema = z
  .object({
    // A member of this company, or null for nobody in particular.
    ownerUserId: z.string().uuid().nullable().optional(),
    // null lifts the lock.
    accessLock: z.enum(ACCESS_LOCK_LEVELS).nullable().optional(),
  })
  .refine((v) => v.ownerUserId !== undefined || v.accessLock !== undefined, { message: "nothing_to_change" });

export class ContactVisibilityDto extends createZodDto(contactVisibilitySchema) {}
