import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Ip, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import type { Request } from "express";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CreateIssueDto, DraftIssueDto, MeNewsletterDto, SubscribeDto, UpdateIssueDto } from "./newsletter.schemas";
import { NewsletterService } from "./newsletter.service";

/**
 * Public sign-up and the double opt-in confirmation. The confirmation link's
 * token is the authority; the sign-up answer never says whether an address
 * is already subscribed.
 */
@ApiTags("newsletter")
@Controller("v1/public/newsletter")
export class PublicNewsletterController {
  private readonly perVisitor = new SlidingWindowLimiter(60 * 60 * 1000, 8);
  private readonly confirmLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 30);

  constructor(private readonly newsletter: NewsletterService) {}

  private limit(limiter: SlidingWindowLimiter, ip: string, req: Request) {
    if (!limiter.hit(visitorIp(ip, req))) throw new HttpException({ error: "newsletter_rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }

  @Post("subscribe")
  @HttpCode(202)
  @ApiOperation({ summary: "Sign up; sends the double opt-in e-mail (same answer whatever the address's state)" })
  subscribe(@Body() dto: SubscribeDto, @Ip() ip: string, @Req() req: Request) {
    this.limit(this.perVisitor, ip, req);
    return this.newsletter.subscribe(dto);
  }

  @Get("confirm/:token")
  @ApiOperation({ summary: "What the confirmation page shows (does not confirm: mail scanners open links)" })
  preview(@Param("token") token: string, @Ip() ip: string, @Req() req: Request) {
    this.limit(this.confirmLimiter, ip, req);
    return this.newsletter.confirmPreview(token);
  }

  @Post("confirm/:token")
  @HttpCode(200)
  @ApiOperation({ summary: "Confirm the subscription" })
  confirm(@Param("token") token: string, @Ip() ip: string, @Req() req: Request) {
    this.limit(this.confirmLimiter, ip, req);
    return this.newsletter.confirm(token);
  }
}

/** The signed-in user's newsletter toggle (Settings → E-mail notifications). */
@ApiTags("newsletter")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/me/newsletter")
export class MeNewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  /** The company's country is only the default for a new subscription. */
  private async country(req: TenantScopedRequest): Promise<"CZ" | "SK"> {
    const [t] = await req
      .tenantDb!.select({ country: schema.tenants.addressCountry })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, req.user!.tenantId));
    return t?.country === "SK" ? "SK" : "CZ";
  }

  @Get()
  @ApiOperation({ summary: "Newsletter status for the signed-in user's address" })
  async get(@Req() req: TenantScopedRequest) {
    return this.newsletter.getForUser(req.user!.id, await this.country(req));
  }

  @Put()
  @ApiOperation({ summary: "Subscribe, change topics or unsubscribe" })
  async set(@Req() req: TenantScopedRequest, @Body() dto: MeNewsletterDto) {
    return this.newsletter.setForUser(req.user!.id, await this.country(req), dto);
  }
}

/** Billanta staff: audience numbers, issues, draft from the blog and deadlines, send. */
@ApiTags("newsletter")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/newsletter")
export class AdminNewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  @Get("stats")
  stats() {
    return this.newsletter.stats();
  }

  @Get("issues")
  list() {
    return this.newsletter.listIssues();
  }

  @Post("issues")
  create(@Body() dto: CreateIssueDto, @Req() req: TenantScopedRequest) {
    return this.newsletter.createIssue(dto, req.user!.id);
  }

  @Post("issues/draft")
  @ApiOperation({ summary: "New draft from recent blog posts and upcoming tax deadlines" })
  draft(@Body() dto: DraftIssueDto, @Req() req: TenantScopedRequest) {
    return this.newsletter.createDraft(dto.locale, dto.country, req.user!.id);
  }

  @Get("issues/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.newsletter.getIssue(id);
  }

  @Put("issues/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateIssueDto) {
    return this.newsletter.updateIssue(id, dto);
  }

  @Delete("issues/:id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.newsletter.deleteIssue(id);
  }

  @Get("issues/:id/preview")
  preview(@Param("id", ParseUUIDPipe) id: string) {
    return this.newsletter.preview(id);
  }

  @Post("issues/:id/send")
  @HttpCode(202)
  @ApiOperation({ summary: "Queue the issue for every confirmed subscriber in its audience (resumable)" })
  send(@Param("id", ParseUUIDPipe) id: string) {
    return this.newsletter.send(id);
  }
}
