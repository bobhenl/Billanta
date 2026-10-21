import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { RequireActiveSubscription } from "../billing/require-active-subscription.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import {
  BulkInvoiceDto,
  CreateInvoiceTemplateDto,
  UpdateInvoiceTemplateDto,
} from "./dto/invoice-template.dto";
import { InvoiceTemplatesService } from "./invoice-templates.service";

/** Invoice templates + bulk invoicing. Dashboard JWT or public-API key. */
@ApiTags("invoice-templates")
@ApiBearerAuth()
@UseGuards(CombinedAuthGuard)
@Controller("v1/invoice-templates")
export class InvoiceTemplatesController {
  constructor(private readonly templatesService: InvoiceTemplatesService) {}

  @Get()
  @ApiOperation({ summary: "Saved templates, most used first" })
  list(@Req() req: TenantScopedRequest) {
    return this.templatesService.list(req.tenantDb!);
  }

  @Get(":id")
  @ApiOperation({ summary: "One template" })
  findOne(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.templatesService.findOne(req.tenantDb!, id);
  }

  @Post()
  @ApiOperation({ summary: "Create a template" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateInvoiceTemplateDto) {
    return this.templatesService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Post("from-invoice/:invoiceId")
  @ApiOperation({ summary: "Save an existing document as a template (optional body { name })" })
  fromInvoice(
    @Req() req: TenantScopedRequest,
    @Param("invoiceId", ParseUUIDPipe) invoiceId: string,
    @Body() body: { name?: string } = {},
  ) {
    return this.templatesService.createFromInvoice(req.tenantDb!, req.user!.tenantId, invoiceId, body?.name);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Edit a template (line_items, when sent, replaces all)" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceTemplateDto) {
    return this.templatesService.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a template" })
  remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.templatesService.remove(req.tenantDb!, id);
  }

  @Post(":id/bulk")
  @RequireActiveSubscription()
  @ApiOperation({
    summary: "Bulk invoicing: one document per customer from this template",
    description: "Body { contact_ids[], issue_date?, issue? } – issue=true issues every draft right away.",
  })
  bulk(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: BulkInvoiceDto) {
    return this.templatesService.bulk(req.tenantDb!, req.user!.tenantId, req.user!.id, id, dto);
  }
}
