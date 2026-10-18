import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, NotFoundException, Post, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { DEMO_ROLES, DemoTransferService, type DemoRole } from "./demo-transfer.service";

/**
 * The demo's own actions inside a company (tenant context):
 *   - `role` and `transfer` only from inside a demo, for the frontend's
 *     /api/demo/role and /api/demo/transfer routes;
 *   - `transfer/claim` only from a real company, after sign-up.
 * Open to every role (`v1/demo` is a personal prefix in RoleAccessGuard):
 * a visitor looking as the read-only colleague must be able to switch back.
 */
@ApiExcludeController()
@UseGuards(JwtAuthGuard)
@Controller("v1/demo")
export class DemoTenantController {
  constructor(private readonly transfer: DemoTransferService) {}

  @Post("role")
  @HttpCode(200)
  async role(@Req() req: TenantScopedRequest, @Body() body: { role?: unknown } | undefined) {
    if (!req.user!.demo) throw new NotFoundException();
    const role = DEMO_ROLES.find((r) => r === body?.role);
    if (!role) throw new BadRequestException("invalid_role");
    return { userId: await this.transfer.member(req.tenantDb!, req.user!.tenantId, role as DemoRole) };
  }

  @Post("transfer")
  @HttpCode(200)
  async issue(@Req() req: TenantScopedRequest) {
    if (!req.user!.demo) throw new NotFoundException();
    return { token: await this.transfer.issue(req.tenantDb!, req.user!.tenantId) };
  }

  @Post("transfer/claim")
  @HttpCode(200)
  async claim(@Req() req: TenantScopedRequest, @Body() body: { token?: unknown } | undefined) {
    if (req.user!.demo) throw new ForbiddenException("demo_disabled");
    // Filling the company with documents is the owner's or an admin's call.
    if (req.user!.role !== "owner" && req.user!.role !== "admin") throw new ForbiddenException("forbidden");
    if (typeof body?.token !== "string") throw new BadRequestException("demo_transfer_invalid");
    return this.transfer.claim(req.tenantDb!, req.user!.tenantId, body.token);
  }
}
