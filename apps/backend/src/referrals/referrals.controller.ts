import { Body, Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ClaimReferralDto, RedeemCreditsDto, ReferralProgramDto } from "./dto/referrals.dto";
import { ReferralsService } from "./referrals.service";

/**
 * Invite companies, earn credits, pay plans with them. Tenant-scoped
 * (`TenantContextMiddleware`); `v1/referrals` is in the role guard's admin
 * prefixes, so only owners and admins spend the company's credits or change
 * its programme. Reads are open to every member.
 */
@ApiTags("referrals")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/referrals")
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @ApiOperation({ summary: "Invite code, programme, credit balance, invited companies and credit history" })
  overview(@Req() req: TenantScopedRequest) {
    return this.referrals.overview(req.tenantDb!, req.user!.tenantId);
  }

  @Post("claim")
  @ApiOperation({ summary: "Record that this (new) company was invited with `code`; credits the welcome bonus" })
  claim(@Req() req: TenantScopedRequest, @Body() dto: ClaimReferralDto) {
    return this.referrals.claim(req.tenantDb!, dto.code);
  }

  @Patch("program")
  @ApiOperation({ summary: "Switch between the friend and the accountant (partner) programme" })
  setProgram(@Req() req: TenantScopedRequest, @Body() dto: ReferralProgramDto) {
    return this.referrals.setProgram(req.tenantDb!, req.user!.tenantId, dto.program);
  }

  @Post("partner-request")
  @ApiOperation({ summary: "Ask Billanta staff for the accountant partner programme (needs an accountant directory listing)" })
  requestPartner(@Req() req: TenantScopedRequest) {
    return this.referrals.requestPartner(req.tenantDb!, req.user!.tenantId);
  }

  @Post("redeem")
  @ApiOperation({ summary: "Pay 1 or 12 months of a plan with credits" })
  redeem(@Req() req: TenantScopedRequest, @Body() dto: RedeemCreditsDto) {
    return this.referrals.redeem(req.tenantDb!, req.user!.tenantId, dto.plan, dto.months);
  }
}
