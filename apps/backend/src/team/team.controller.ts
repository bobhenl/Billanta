import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CreateInvitationDto, UpdateMemberDto } from "./dto/create-invitation.dto";
import { TeamService } from "./team.service";

/** Tenant-scoped team management — registered on TenantContextMiddleware. */
@ApiTags("team")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/team")
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Get()
  @ApiOperation({ summary: "Members of the current tenant plus pending invitations" })
  list(@Req() req: TenantScopedRequest) {
    return this.teamService.list(req.tenantDb!);
  }

  @Post("invitations")
  @ApiOperation({
    summary: "Invite someone (e.g. an accountant) by email",
    description: "Owner/admin only. The response also carries the accept link, for passing it on manually.",
  })
  invite(@Req() req: TenantScopedRequest, @Body() dto: CreateInvitationDto) {
    return this.teamService.invite(req.tenantDb!, req.user!, dto);
  }

  @Delete("invitations/:id")
  @ApiOperation({ summary: "Revoke a pending invitation" })
  revoke(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.teamService.revokeInvitation(req.tenantDb!, req.user!, id);
  }

  @Patch("members/:id")
  @ApiOperation({ summary: "Change a member's role (not the owner's)" })
  updateMember(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.teamService.updateMember(req.tenantDb!, req.user!, id, dto.role, dto.permissions);
  }

  @Delete("members/:id")
  @ApiOperation({ summary: "Remove a member, or leave the tenant yourself" })
  removeMember(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.teamService.removeMember(req.tenantDb!, req.user!, id);
  }
}
