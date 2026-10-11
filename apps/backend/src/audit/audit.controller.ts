import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { AuditService } from "./audit.service";

/** Every member can read the company's change history. */
@ApiTags("audit-log")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/audit-log")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: "Change history, newest first; filter by entity, member and period (from/to, YYYY-MM-DD), page with ?before=<createdAt>" })
  list(
    @Req() req: TenantScopedRequest,
    @Query("entity_type") entityType?: string,
    @Query("entity_id") entityId?: string,
    @Query("limit") limit?: string,
    @Query("before") before?: string,
    @Query("user_id") userId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("action") action?: string,
  ) {
    const uuid = /^[0-9a-f-]{36}$/i;
    return this.auditService.list(req.tenantDb!, req.user!.tenantId, {
      entityType: entityType?.slice(0, 40),
      entityId: entityId && uuid.test(entityId) ? entityId : undefined,
      limit: Number(limit) || 50,
      before,
      userId: userId && uuid.test(userId) ? userId : undefined,
      from,
      to,
      action: action?.slice(0, 40),
    });
  }
}
