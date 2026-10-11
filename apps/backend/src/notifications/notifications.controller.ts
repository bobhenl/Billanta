import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { notificationPrefsSchema } from "./notification-prefs";
import { NotificationsService } from "./notifications.service";

class NotificationPrefsDto extends createZodDto(notificationPrefsSchema) {}

/** The signed-in member's notifications and their own settings. */
@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/me/notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "Latest notifications (newest first)" })
  list(@Req() req: TenantScopedRequest, @Query("limit") limit?: string) {
    return this.notificationsService.list(req.tenantDb!, req.user!.id, Number(limit) || 30);
  }

  @Get("unread-count")
  @ApiOperation({ summary: "Number of unread notifications, for the bell badge" })
  unread(@Req() req: TenantScopedRequest) {
    return this.notificationsService.unreadCount(req.tenantDb!, req.user!.id);
  }

  @Post("read")
  @ApiOperation({ summary: "Mark all as read" })
  readAll(@Req() req: TenantScopedRequest) {
    return this.notificationsService.markRead(req.tenantDb!, req.user!.id);
  }

  @Post(":id/read")
  @ApiOperation({ summary: "Mark one as read" })
  readOne(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(req.tenantDb!, req.user!.id, id);
  }

  @Get("prefs")
  @ApiOperation({ summary: "Which events reach me, and how (in-app / email)" })
  getPrefs(@Req() req: TenantScopedRequest) {
    return this.notificationsService.getPrefs(req.tenantDb!, req.user!.tenantId, req.user!.id);
  }

  @Put("prefs")
  @ApiOperation({ summary: "Change my notification settings (partial)" })
  setPrefs(@Req() req: TenantScopedRequest, @Body() dto: NotificationPrefsDto) {
    return this.notificationsService.setPrefs(req.tenantDb!, req.user!.tenantId, req.user!.id, dto);
  }
}
