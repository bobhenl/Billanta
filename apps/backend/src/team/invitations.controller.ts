import { Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { TeamService } from "./team.service";

/**
 * Pre-tenant invitation routes: the invitee has no membership yet, so —
 * like MeController — this is JWT-only and NEVER on TenantContextMiddleware.
 * Both routes go through SECURITY DEFINER functions keyed on the token hash.
 */
@ApiTags("team")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/invitations")
export class InvitationsController {
  constructor(private readonly teamService: TeamService) {}

  @Get(":token")
  @ApiOperation({ summary: "What an invitation link is for (company, role, invited email)" })
  preview(@Param("token") token: string) {
    return this.teamService.preview(token);
  }

  @Post(":token/accept")
  @ApiOperation({ summary: "Join the inviting tenant; the signed-in email must match the invitation" })
  accept(@Req() req: TenantScopedRequest, @Param("token") token: string) {
    return this.teamService.accept(token, req.user!.id);
  }
}
