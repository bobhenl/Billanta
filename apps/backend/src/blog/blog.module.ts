import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AdminBlogController } from "./admin-blog.controller";
import { BlogDraftsService } from "./blog-drafts.service";
import { BlogService } from "./blog.service";
import { PublicBlogController } from "./public-blog.controller";

@Module({
  controllers: [PublicBlogController, AdminBlogController],
  providers: [BlogService, BlogDraftsService, PlatformAdminGuard],
})
export class BlogModule {}
