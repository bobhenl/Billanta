import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { saveListingSchema } from "./listing";

export class SaveListingDto extends createZodDto(saveListingSchema) {}

export const reviewListingSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).nullish(),
  /** The `updated_at` the admin reviewed, so a later edit is not approved unseen. */
  updatedAt: z.string().datetime({ offset: true }),
  /** Decide the company's pending partner request together with the listing. */
  partner: z.boolean().optional(),
});
export class ReviewListingDto extends createZodDto(reviewListingSchema) {}

export const reviewPartnerSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).nullish(),
});
export class ReviewPartnerDto extends createZodDto(reviewPartnerSchema) {}
