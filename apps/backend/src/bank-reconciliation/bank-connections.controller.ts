import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TwoFactorGuard } from "../auth/two-factor.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { BankConnectionsService } from "./bank-connections.service";
import { CompletePsd2Dto, CreateBankConnectionDto, CreatePaypalDto, StartPsd2Dto, UpdateBankConnectionDto } from "./dto/bank-connection.dto";

/** Connecting a bank account is an owner/admin action; any non-viewer may trigger a sync. */
function requireRole(req: TenantScopedRequest, roles: string[]) {
  if (!req.user?.role || !roles.includes(req.user.role)) {
    throw new ForbiddenException("Your role cannot manage bank connections");
  }
}

@ApiTags("bank-reconciliation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/bank-reconciliation/connections")
export class BankConnectionsController {
  constructor(private readonly service: BankConnectionsService) {}

  @Get()
  @ApiOperation({ summary: "List bank API connections (tokens are never returned)" })
  list(@Req() req: TenantScopedRequest) {
    return this.service.list(req.tenantDb!);
  }

  @Post()
  @UseGuards(TwoFactorGuard)
  @ApiOperation({ summary: "Connect a Fio account with a read-only API token" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateBankConnectionDto) {
    requireRole(req, ["owner", "admin"]);
    return this.service.createFio(req.tenantDb!, req.user!.tenantId, dto.token, dto.label ?? null);
  }

  @Post("paypal")
  @UseGuards(TwoFactorGuard)
  @ApiOperation({ summary: "Connect a PayPal account with REST app credentials (Transaction Search)" })
  createPaypal(@Req() req: TenantScopedRequest, @Body() dto: CreatePaypalDto) {
    requireRole(req, ["owner", "admin"]);
    return this.service.createPaypal(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get("psd2")
  @ApiOperation({ summary: "Whether PSD2 bank connections are available on this server, and for which countries" })
  psd2Status() {
    return this.service.psd2Status();
  }

  @Get("psd2/banks")
  @ApiOperation({ summary: "Banks reachable over PSD2 (Enable Banking) in a country" })
  psd2Banks(@Query("country") country = "CZ") {
    return this.service.listPsd2Banks(String(country));
  }

  @Post("psd2/start")
  @UseGuards(TwoFactorGuard)
  @ApiOperation({ summary: "Start PSD2 consent at the bank; returns the bank URL to redirect the user to" })
  psd2Start(@Req() req: TenantScopedRequest, @Body() dto: StartPsd2Dto) {
    requireRole(req, ["owner", "admin"]);
    return this.service.startPsd2(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Post("psd2/complete")
  @UseGuards(TwoFactorGuard)
  @ApiOperation({ summary: "Finish PSD2 consent with the code the bank returned" })
  psd2Complete(@Req() req: TenantScopedRequest, @Body() dto: CompletePsd2Dto) {
    requireRole(req, ["owner", "admin"]);
    return this.service.completePsd2(req.tenantDb!, req.user!.tenantId, dto.code, dto.state);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Pause/resume automatic sync or rename a connection" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBankConnectionDto) {
    requireRole(req, ["owner", "admin"]);
    return this.service.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Disconnect a bank account and forget its token" })
  async remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    requireRole(req, ["owner", "admin"]);
    await this.service.remove(req.tenantDb!, id);
  }

  @Post(":id/sync")
  @ApiOperation({ summary: "Download new incoming payments now and auto-match them" })
  sync(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    requireRole(req, ["owner", "admin", "accountant"]);
    return this.service.syncOne(req.tenantDb!, req.user!.tenantId, id);
  }
}
