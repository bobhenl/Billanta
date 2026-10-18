import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { BLOG_LOCALES, BlogService, type BlogLocale } from "./blog.service";

const locale = (raw: string): BlogLocale => {
  if (!(BLOG_LOCALES as readonly string[]).includes(raw)) throw new NotFoundException("Unknown locale");
  return raw as BlogLocale;
};

/** PUBLIC blog: published posts only, no guard, no tenant context. */
@ApiTags("public-blog")
@Controller("v1/public/blog")
export class PublicBlogController {
  constructor(private readonly blog: BlogService) {}

  @Get("sitemap")
  @ApiOperation({ summary: "Every published post in every locale (for the sitemap)" })
  sitemap() {
    return this.blog.listForSitemap();
  }

  @Get(":locale")
  @ApiOperation({ summary: "Published posts in one locale, newest first" })
  list(@Param("locale") raw: string) {
    return this.blog.listPublic(locale(raw));
  }

  @Get(":locale/:slug")
  @ApiOperation({ summary: "One published post with its published translations" })
  get(@Param("locale") raw: string, @Param("slug") slug: string) {
    return this.blog.getPublic(locale(raw), slug.slice(0, 100));
  }
}
