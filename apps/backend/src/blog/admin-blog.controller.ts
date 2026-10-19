import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { BlogDraftsService } from "./blog-drafts.service";
import { WEEKLY_AUTOPUBLISH_LIMIT } from "./blog-autopublish";
import {
  AutopublishKindParam,
  BriefDraftDto,
  CreateBlogPostDto,
  NextTopicDraftDto,
  PublishBlogPostDto,
  SetAutopublishDto,
  TaxDeadlinesDraftDto,
  UpdateBlogPostDto,
} from "./blog.dto";
import { BlogService } from "./blog.service";

/** Blog management and the AI draft queue for Billanta staff (`PLATFORM_ADMIN_EMAILS`). */
@ApiTags("admin-blog")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/blog")
export class AdminBlogController {
  constructor(
    private readonly blog: BlogService,
    private readonly drafts: BlogDraftsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "All posts in every status, without bodies" })
  list() {
    return this.blog.listAll();
  }

  // Static routes before ":id" (ParseUUIDPipe would reject them).
  @Get("autopublish")
  @ApiOperation({ summary: "Auto-publish switch per generated kind, plus this week's auto-published count per locale and the cap" })
  async autopublish() {
    const [settings, thisWeek] = await Promise.all([this.blog.autopublishSettings(), this.blog.autoPublishedThisWeek()]);
    return { settings, thisWeek, weeklyLimit: WEEKLY_AUTOPUBLISH_LIMIT };
  }

  @Put("autopublish/:kind")
  @ApiOperation({ summary: "Switch auto-publishing of one generated kind on or off" })
  async setAutopublish(@Param() params: AutopublishKindParam, @Body() dto: SetAutopublishDto) {
    await this.blog.setAutopublish(params.kind, dto.enabled);
    return this.autopublish();
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.blog.get(id);
  }

  @Post()
  create(@Body() dto: CreateBlogPostDto) {
    return this.blog.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blog.update(id, dto);
  }

  @Post(":id/publish")
  @HttpCode(200)
  @ApiOperation({ summary: "Publish; a post with warnings needs `force: true`" })
  publish(@Param("id", ParseUUIDPipe) id: string, @Body() dto: PublishBlogPostDto) {
    return this.blog.publish(id, dto.force);
  }

  @Post(":id/unpublish")
  @HttpCode(200)
  unpublish(@Param("id", ParseUUIDPipe) id: string) {
    return this.blog.setStatus(id, "draft");
  }

  @Post(":id/reject")
  @HttpCode(200)
  reject(@Param("id", ParseUUIDPipe) id: string) {
    return this.blog.setStatus(id, "rejected");
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.blog.remove(id);
  }

  @Post("drafts/tax-deadlines")
  @ApiOperation({ summary: "AI draft of the Czech tax deadlines post for one month (null if it exists or the month has none)" })
  taxDeadlines(@Body() dto: TaxDeadlinesDraftDto) {
    return this.drafts.taxDeadlines(dto.year, dto.month);
  }

  @Post("drafts/next")
  @ApiOperation({ summary: "AI draft of the next unwritten tool how-to or trade invoicing topic (null when all are written)" })
  next(@Body() dto: NextTopicDraftDto) {
    return this.drafts.nextDraft(dto.kind, dto.locale);
  }

  @Post("drafts/brief")
  @ApiOperation({ summary: "AI draft from a topic, facts and sources (a few per week)" })
  brief(@Body() dto: BriefDraftDto) {
    return this.drafts.brief(dto);
  }
}
