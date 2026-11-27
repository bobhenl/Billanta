import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { NetIncomeInputs } from "@faktur/cz-compliance";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { NetIncomeService, type NetIncomePeriod } from "./net-income.service";
import { DEFAULT_TAX_MODEL, sharesSchema, taxModelSchema } from "./tax-model";

const periodQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12).optional(),
    quarter: z.coerce.number().int().min(1).max(4).optional(),
  })
  .refine((q) => !(q.month && q.quarter), "month_or_quarter");

function periodOf(query: Record<string, string>): NetIncomePeriod {
  const parsed = periodQuerySchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException("invalid_period");
  const { year, month, quarter } = parsed.data;
  return { year, month: month ?? null, quarter: quarter ?? null };
}

class TaxModelDto extends createZodDto(taxModelSchema) {}
class PartnerSharesDto extends createZodDto(z.object({ shares: sharesSchema.nullable() })) {}

/** Report "Po zdanění" (owners, admins and members linked to a partner, RoleAccessGuard). */
@ApiTags("net-income")
@Controller("v1/net-income")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NetIncomeController {
  constructor(private readonly service: NetIncomeService) {}

  @Get()
  @ApiOperation({ summary: "Income from paid invoices in a month, quarter or year, split between partners, minus tax, insurance and shared expenses (?year=&month=|quarter=)" })
  report(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    return this.service.report(req.tenantDb!, req.user!.tenantId, periodOf(query));
  }

  // Under v1/net-income, so the same rule of RoleAccessGuard applies.
  @Get("inputs")
  @ApiOperation({
    summary:
      "Confidential mode: the report's inputs (?year=&month=|quarter=), the sealed documents with their totals envelope and rate instead of an amount, so the browser builds the report",
  })
  inputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>): Promise<NetIncomeInputs> {
    return this.service.inputs(req.tenantDb!, req.user!.tenantId, periodOf(query));
  }
}

/** The tax model is company administration: only owners and admins change it, linked partners may read it (RoleAccessGuard). */
@ApiTags("net-income")
@Controller("v1/tenants/me/tax-model")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TaxModelController {
  constructor(private readonly service: NetIncomeService) {}

  @Get()
  @ApiOperation({ summary: "The company's tax model for the net income report, and the defaults" })
  async get(@Req() req: TenantScopedRequest) {
    return { model: await this.service.model(req.tenantDb!, req.user!.tenantId), defaults: DEFAULT_TAX_MODEL };
  }

  @Put()
  @ApiOperation({ summary: "Replace the tax model (rates, partners, shared expenses, extra income)" })
  save(@Req() req: TenantScopedRequest, @Body() body: TaxModelDto) {
    return this.service.saveModel(req.tenantDb!, req.user!.tenantId, taxModelSchema.parse(body));
  }
}

/** Under v1/invoices so it follows the member's invoice permission. */
@ApiTags("net-income")
@Controller("v1/invoices")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InvoicePartnerSharesController {
  constructor(private readonly service: NetIncomeService) {}

  @Put(":id/partner-shares")
  @ApiOperation({ summary: "Split one invoice between partners in the net income report ({ shares: {partnerId: weight} | null })" })
  setShares(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() body: PartnerSharesDto) {
    return this.service.setInvoiceShares(req.tenantDb!, id, body.shares);
  }
}
