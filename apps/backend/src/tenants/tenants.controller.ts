import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { planSummary } from "../billing/plan-access";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { effectivePermissions } from "../tenancy/permissions";
import { BankAccountDto } from "./dto/bank-account.dto";
import { NumberFormatsDto } from "./dto/number-formats.dto";
import { resolveModules } from "./modules";
import { UpdateTenantDto } from "./dto/update-tenant.dto";
import { TenantsService } from "./tenants.service";

const MAX_LOGO_BYTES = 512 * 1024;

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

  @Get("me/access")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "What the signed-in member may do here: role, per-area permissions and the company's enabled modules" })
  async getAccess(@Req() req: TenantScopedRequest) {
    const [tenant] = await this.tenantsService.findById(req.tenantDb!, req.user!.tenantId);
    return {
      role: req.user!.role,
      permissions: effectivePermissions(req.user!.role, req.user!.permissions),
      modules: resolveModules(tenant?.enabledModules),
      // Drives the trial banner and the read-only state of paid features.
      plan: tenant ? planSummary(tenant, new Date()) : null,
    };
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update the company profile, bank details and invoice defaults (owner/admin)" })
  updateCurrentTenant(@Req() req: TenantScopedRequest, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(req.tenantDb!, req.user!.tenantId, req.user!.role, dto);
  }

  @Get("me/number-formats")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Document number pattern per type, counters and a preview of the next number (owner/admin)" })
  getNumberFormats(@Req() req: TenantScopedRequest) {
    return this.tenantsService.getNumberFormats(req.tenantDb!, req.user!.tenantId, req.user!.role);
  }

  @Put("me/number-formats")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set the number pattern and the next number per document type; affects only numbers issued from now on (owner/admin)" })
  updateNumberFormats(@Req() req: TenantScopedRequest, @Body() dto: NumberFormatsDto) {
    return this.tenantsService.updateNumberFormats(req.tenantDb!, req.user!.tenantId, req.user!.role, dto);
  }

  @Get("me/public-profile/slug")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Whether a public-profile slug is free for this company (format, reserved, taken)" })
  checkProfileSlug(@Req() req: TenantScopedRequest, @Query("slug") slug = "") {
    return this.tenantsService.profileSlugStatus(req.tenantDb!, req.user!.tenantId, String(slug).slice(0, 64));
  }

  @Get("me/logo")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The company logo image (404 when none)" })
  async getLogo(@Req() req: TenantScopedRequest, @Res() res: Response) {
    const logo = await this.tenantsService.getLogo(req.tenantDb!, req.user!.tenantId);
    if (!logo) throw new NotFoundException("No logo");
    res.setHeader("Content-Type", logo.mime);
    res.setHeader("Cache-Control", "private, no-cache");
    res.send(logo.data);
  }

  @Put("me/logo")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_LOGO_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiOperation({ summary: "Upload the company logo – PNG or JPEG up to 512 kB, multipart field \"file\" (owner/admin)" })
  uploadLogo(@Req() req: TenantScopedRequest, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    return this.tenantsService.setLogo(req.tenantDb!, req.user!.tenantId, req.user!.role, file.buffer);
  }

  @Delete("me/logo")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove the company logo (owner/admin)" })
  deleteLogo(@Req() req: TenantScopedRequest) {
    return this.tenantsService.setLogo(req.tenantDb!, req.user!.tenantId, req.user!.role, null);
  }

  @Get("me/bank-accounts")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Extra bank accounts (besides the primary one on the company profile)" })
  listBankAccounts(@Req() req: TenantScopedRequest) {
    return this.tenantsService.listBankAccounts(req.tenantDb!, req.user!.tenantId);
  }

  @Post("me/bank-accounts")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Add a bank account (owner/admin)" })
  createBankAccount(@Req() req: TenantScopedRequest, @Body() dto: BankAccountDto) {
    return this.tenantsService.createBankAccount(req.tenantDb!, req.user!.tenantId, req.user!.role, dto);
  }

  @Put("me/bank-accounts/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Replace a bank account (owner/admin)" })
  updateBankAccount(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BankAccountDto,
  ) {
    return this.tenantsService.updateBankAccount(req.tenantDb!, req.user!.tenantId, req.user!.role, id, dto);
  }

  @Delete("me/bank-accounts/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Remove a bank account (owner/admin)" })
  deleteBankAccount(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.tenantsService.deleteBankAccount(req.tenantDb!, req.user!.tenantId, req.user!.role, id);
  }

  // Deliberately NOT behind JwtAuthGuard: signup is how a brand-new tenant
  // (and its owning user) comes into existence, so there is no tenant JWT
  // yet at this point — see the bootstrap TODO in TenantsService.signup().
  @Post()
  @ApiOperation({ summary: "Tenant signup (TODO: not yet implemented – bootstrap path)" })
  signup() {
    return this.tenantsService.signup();
  }
}
