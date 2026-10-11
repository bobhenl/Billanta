import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CreateRecurringInvoiceDto } from "./dto/create-recurring-invoice.dto";
import { UpdateRecurringInvoiceDto } from "./dto/update-recurring-invoice.dto";
import { RecurringInvoicesService } from "./recurring-invoices.service";

/**
 * CRUD over `recurring_invoice_templates` (drizzle/schema.ts). The actual
 * invoice-materialization job lives in
 * `RecurringInvoiceGenerationService.run()` (a daily `@Cron`), not here —
 * this controller only manages the template rows a tenant defines.
 */
@ApiTags("recurring-invoices")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/recurring-invoices")
export class RecurringInvoicesController {
  constructor(private readonly recurringInvoicesService: RecurringInvoicesService) {}

  @Get()
  @ApiOperation({ summary: "List recurring invoice templates for the current tenant" })
  list(@Req() req: TenantScopedRequest) {
    return this.recurringInvoicesService.list(req.tenantDb!);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a recurring invoice template by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.recurringInvoicesService.findOne(req.tenantDb!, id);
  }

  @Post()
  @ApiOperation({ summary: "Create a recurring invoice template" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateRecurringInvoiceDto) {
    return this.recurringInvoicesService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a recurring invoice template" })
  update(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateRecurringInvoiceDto,
  ) {
    return this.recurringInvoicesService.update(req.tenantDb!, id, dto);
  }

  /**
   * Soft delete — sets `is_active = false`. Never hard-deletes: invoices
   * already generated from this template (`invoices.source = 'recurring'`)
   * must keep referencing real history even after the standing arrangement
   * is retired.
   */
  @Post(":id/deactivate")
  @ApiOperation({ summary: "Deactivate a recurring invoice template (soft delete)" })
  deactivate(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.recurringInvoicesService.deactivate(req.tenantDb!, id);
  }
}
