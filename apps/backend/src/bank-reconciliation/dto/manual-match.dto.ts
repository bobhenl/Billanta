import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const manualMatchSchema = z.object({
  invoiceId: z.string().uuid(),
});

export class ManualMatchDto extends createZodDto(manualMatchSchema) {}
