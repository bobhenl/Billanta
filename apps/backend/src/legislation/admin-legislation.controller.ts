import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { LegislationService, MANUAL_CHECK_MIN_AGE_MS } from "./legislation.service";

/** Legislation monitor for Billanta staff (`PLATFORM_ADMIN_EMAILS`): watched pages and open alerts. */
@ApiTags("admin-legislation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/legislation")
export class AdminLegislationController {
  constructor(private readonly service: LegislationService) {}

  @Get()
  @ApiOperation({ summary: "Watched sources, their state and open alerts" })
  overview() {
    return this.service.overview();
  }

  @Post("check")
  @HttpCode(200)
  @ApiOperation({ summary: "Check now; sources fetched within the last day are skipped" })
  check() {
    return this.service.runCheck(MANUAL_CHECK_MIN_AGE_MS);
  }

  @Post("alerts/:id/ack")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark an alert reviewed and confirm the source's current content" })
  acknowledge(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.acknowledge(id);
  }
}
