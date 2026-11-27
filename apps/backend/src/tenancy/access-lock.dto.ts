import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ACCESS_LOCK_LEVELS } from "./visibility";

/** Body for `PATCH .../:id/access-lock` on invoices and expenses; null lifts the lock. */
export const accessLockSchema = z.object({ level: z.enum(ACCESS_LOCK_LEVELS).nullable() });

export class SetAccessLockDto extends createZodDto(accessLockSchema) {}
