import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { AUTO_PUBLISH_KINDS } from "./blog-autopublish";
import { TOPIC_LOCALES } from "./blog-topics";
import { BLOG_LOCALES, blogPostSchema, blogSourceSchema } from "./blog.service";

export class CreateBlogPostDto extends createZodDto(blogPostSchema) {}
export class UpdateBlogPostDto extends createZodDto(blogPostSchema.partial()) {}

export class PublishBlogPostDto extends createZodDto(z.object({ force: z.boolean().default(false) })) {}

export class TaxDeadlinesDraftDto extends createZodDto(
  z.object({ year: z.coerce.number().int().min(2024).max(2100), month: z.coerce.number().int().min(1).max(12) }),
) {}

export class BriefDraftDto extends createZodDto(
  z.object({
    locale: z.enum(BLOG_LOCALES),
    topic: z.string().trim().min(5).max(500),
    facts: z.string().trim().min(20).max(10_000),
    sources: z.array(blogSourceSchema).min(1).max(10),
  }),
) {}

export class NextTopicDraftDto extends createZodDto(
  z.object({ kind: z.enum(["tool_howto", "trade_invoicing"]), locale: z.enum(TOPIC_LOCALES as ["cs", "sk"]) }),
) {}

export class AutopublishKindParam extends createZodDto(z.object({ kind: z.enum(AUTO_PUBLISH_KINDS) })) {}

export class SetAutopublishDto extends createZodDto(z.object({ enabled: z.boolean() })) {}
