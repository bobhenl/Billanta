import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { planAllows } from "../billing/plan-access";
import { loadPlanSummary, RequirePlan } from "../billing/plan.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { EnableVaultDto, MemberWrapDto, PlainInvoicesQueryDto, RecoveryWrapDto, RekeyInvoiceDto, SealInvoicesDto, VaultSettingsDto } from "./dto/vault.dto";
import { confidentialPlanRequired } from "./sealed";
import { VaultService } from "./vault.service";

/**
 * "Důvěrný režim". `v1/vault/me/*` is personal (each member manages their own
 * unlock methods), `v1/vault/invoices/*` is in the invoices area, the rest is
 * company administration (ADMIN_PREFIXES; enabling is owner-only on top).
 */
@ApiTags("vault")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/vault")
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get("me")
  @ApiOperation({ summary: "Whether the mode is on, with the caller's wrapped keys and the recovery wrap" })
  status(@Req() req: TenantScopedRequest) {
    return this.vault.status(req.tenantDb!, req.user!.tenantId, req.user!.id);
  }

  @Post("me/wraps")
  @ApiOperation({ summary: "Set the caller's vault password or add a passkey (the key wrapped in the browser)" })
  addWrap(@Req() req: TenantScopedRequest, @Body() dto: MemberWrapDto) {
    return this.vault.addWrap(req.tenantDb!, req.user!.tenantId, req.user!.id, dto.wrap);
  }

  @Delete("me/wraps/:id")
  @ApiOperation({ summary: "Remove one of the caller's own unlock methods" })
  removeWrap(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.vault.removeWrap(req.tenantDb!, req.user!.tenantId, req.user!.id, id);
  }

  @Post("enable")
  @RequirePlan("confidential_mode")
  @ApiOperation({ summary: "Switch the mode on (owner only, once)" })
  enable(@Req() req: TenantScopedRequest, @Body() dto: EnableVaultDto) {
    return this.vault.enable(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Put("recovery")
  @ApiOperation({ summary: "Replace the recovery code wrap; the old code stops working" })
  replaceRecovery(@Req() req: TenantScopedRequest, @Body() dto: RecoveryWrapDto) {
    return this.vault.replaceRecovery(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Patch("settings")
  @ApiOperation({ summary: "Whether the editor encrypts new documents by default" })
  async settings(@Req() req: TenantScopedRequest, @Body() dto: VaultSettingsDto) {
    // Turning the default off is always allowed, turning it on needs Plus.
    if (dto.sealNew) await this.requirePlan(req);
    return this.vault.updateSettings(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Get("invoices/plain")
  @ApiOperation({ summary: "Unlocked documents that still hold plain text, for the browser to encrypt" })
  plainInvoices(@Req() req: TenantScopedRequest, @Query() query: PlainInvoicesQueryDto) {
    return this.vault.plainInvoices(req.tenantDb!, req.user!.tenantId, query);
  }

  @Post("invoices/seal")
  @RequirePlan("confidential_mode")
  @ApiOperation({ summary: "Store texts the browser encrypted (text columns only)" })
  seal(@Req() req: TenantScopedRequest, @Body() dto: SealInvoicesDto) {
    return this.vault.seal(req.tenantDb!, req.user!.tenantId, dto);
  }

  // No plan check: it only replaces ciphertext with ciphertext, which a
  // downgraded company must still be able to do for documents it already sealed.
  @Post("invoices/:id/rekey")
  @ApiOperation({ summary: "Store one document's texts re-encrypted under its own key, for the client link" })
  rekey(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RekeyInvoiceDto) {
    return this.vault.rekey(req.tenantDb!, req.user!.tenantId, req.user!, id, dto);
  }

  private async requirePlan(req: TenantScopedRequest) {
    const plan = await loadPlanSummary(req.tenantDb!, req.user!.tenantId);
    if (plan && !planAllows(plan, "confidential_mode")) {
      throw confidentialPlanRequired();
    }
  }
}
