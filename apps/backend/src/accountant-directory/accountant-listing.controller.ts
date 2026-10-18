import { Body, Controller, Delete, Get, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { AccountantDirectoryService } from "./accountant-directory.service";
import { SaveListingDto } from "./dto";

/**
 * The company's own entry in the accountant directory (Settings → Invite
 * for credits, accountant programme). Under `v1/referrals`, so the role
 * guard's admin prefix already limits writes to owners and admins.
 */
@ApiTags("accountant-directory")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/referrals/listing")
export class AccountantListingController {
  constructor(private readonly directory: AccountantDirectoryService) {}

  @Get()
  @ApiOperation({ summary: "Own directory listing and whether the company may have one" })
  get(@Req() req: TenantScopedRequest) {
    return this.directory.own(req.tenantDb!, req.user!.tenantId);
  }

  @Put()
  @ApiOperation({ summary: "Create or edit the listing; every save goes (back) to review" })
  save(@Req() req: TenantScopedRequest, @Body() dto: SaveListingDto) {
    return this.directory.save(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Post("withdraw")
  @ApiOperation({ summary: "Take the listing off the public page" })
  withdraw(@Req() req: TenantScopedRequest) {
    return this.directory.withdraw(req.tenantDb!, req.user!.tenantId);
  }

  @Delete()
  remove(@Req() req: TenantScopedRequest) {
    return this.directory.remove(req.tenantDb!, req.user!.tenantId);
  }
}
