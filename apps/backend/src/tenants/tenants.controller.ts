import { Controller, Get, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { TenantsService } from "./tenants.service";

@ApiTags("tenants")
@Controller("v1/tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get the current tenant" })
  getCurrentTenant(@Req() req: TenantScopedRequest) {
    return this.tenantsService.findById(req.tenantDb!, req.user!.tenantId);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the current tenant (TODO: not yet implemented)" })
  updateCurrentTenant() {
    return this.tenantsService.update();
  }

  // Deliberately NOT behind JwtAuthGuard: signup is how a brand-new tenant
  // (and its owning user) comes into existence, so there is no tenant JWT
  // yet at this point — see the bootstrap TODO in TenantsService.signup().
  @Post()
  @ApiOperation({ summary: "Tenant signup (TODO: not yet implemented — bootstrap path)" })
  signup() {
    return this.tenantsService.signup();
  }
}
