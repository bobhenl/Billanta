import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type { PaymentAuditInputs } from "@faktur/cz-compliance";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { PaymentAuditService } from "./payment-audit.service";

const yearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) });

function yearOf(query: Record<string, string>): number {
  const parsed = yearSchema.safeParse(query);
  if (!parsed.success) throw new BadRequestException("invalid_period");
  return parsed.data.year;
}

/** "Roční audit plateb" (owner and admin only, RoleAccessGuard, like the net income report). */
@ApiTags("payment-audit")
@Controller("v1/payment-audit")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PaymentAuditController {
  constructor(private readonly service: PaymentAuditService) {}

  @Get()
  @ApiOperation({ summary: "The year's invoices against the money found in every source, payments without an invoice, and totals per source (?year=)" })
  report(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    return this.service.report(req.tenantDb!, req.user!.tenantId, yearOf(query));
  }

  @Get("inputs")
  @ApiOperation({ summary: "Confidential mode: the report's inputs (?year=), sealed totals and card payments as envelopes, so the browser builds the report" })
  inputs(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>): Promise<PaymentAuditInputs> {
    return this.service.inputs(req.tenantDb!, req.user!.tenantId, yearOf(query));
  }
}
