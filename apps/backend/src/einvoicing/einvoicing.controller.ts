import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards, type RawBodyRequest } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { createExpenseSchema } from "../expenses/dto/create-expense.dto";
import { EInvoicingService } from "./einvoicing.service";

// Every field optional: the reviewer sends only what they corrected.
class AcceptIncomingDto extends createZodDto(createExpenseSchema.partial()) {}

const listQuerySchema = z.object({ status: z.enum(["pending_review", "accepted", "rejected"]).optional() });
class ListIncomingQueryDto extends createZodDto(listQuerySchema) {}

/** Sending one issued invoice over Peppol, and its delivery status. */
@ApiTags("einvoicing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/invoices/:invoiceId/einvoice")
export class InvoiceEInvoiceController {
  constructor(private readonly einvoicing: EInvoicingService) {}

  @Get()
  @ApiOperation({ summary: "Peppol delivery status of an invoice (latest attempt plus history)" })
  status(@Req() req: TenantScopedRequest, @Param("invoiceId", ParseUUIDPipe) invoiceId: string) {
    return this.einvoicing.getInvoiceStatus(req.tenantDb!, invoiceId);
  }

  @Post()
  @ApiOperation({ summary: "Send an issued invoice or credit note over Peppol" })
  send(@Req() req: TenantScopedRequest, @Param("invoiceId", ParseUUIDPipe) invoiceId: string) {
    return this.einvoicing.sendInvoice(req.tenantDb!, req.user!.tenantId, invoiceId);
  }
}

/**
 * Received e-invoices waiting for review. Under `v1/expenses/` so the
 * expenses permission applies; three segments deep so `v1/expenses/:id`
 * cannot swallow the list route.
 */
@ApiTags("einvoicing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/expenses/einvoices/incoming")
export class IncomingEInvoicesController {
  constructor(private readonly einvoicing: EInvoicingService) {}

  @Get()
  @ApiOperation({ summary: "Received e-invoices, newest first" })
  list(@Req() req: TenantScopedRequest, @Query() query: ListIncomingQueryDto) {
    return this.einvoicing.listIncoming(req.tenantDb!, query.status);
  }

  @Post(":id/accept")
  @ApiOperation({ summary: "Book a received e-invoice as an expense, with the reviewer's corrections" })
  accept(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AcceptIncomingDto) {
    return this.einvoicing.acceptIncoming(req.tenantDb!, req.user!.tenantId, req.user!.id, id, dto);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @ApiOperation({ summary: "Mark a received e-invoice as not an expense (it stays archived)" })
  reject(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.einvoicing.rejectIncoming(req.tenantDb!, req.user!.id, id);
  }
}

/** The company's Peppol registration. Under `v1/tenants/` so only owner/admin may change it. */
@ApiTags("einvoicing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/tenants/me/einvoicing")
export class EInvoicingSettingsController {
  constructor(private readonly einvoicing: EInvoicingService) {}

  @Get()
  @ApiOperation({ summary: "The company's Peppol participant registration, if any" })
  async get(@Req() req: TenantScopedRequest) {
    return { participant: await this.einvoicing.getParticipant(req.tenantDb!) };
  }

  @Post("register")
  @ApiOperation({ summary: "Register the company as a Peppol participant (0245:DIČ)" })
  async register(@Req() req: TenantScopedRequest) {
    return { participant: await this.einvoicing.registerParticipant(req.tenantDb!, req.user!.tenantId) };
  }
}

/**
 * Provider callbacks: no session and no tenant. The adapter verifies the
 * signature over the raw body; the service resolves the company.
 */
@ApiTags("einvoicing")
@Controller("v1/webhooks/einvoicing")
export class EInvoicingWebhookController {
  constructor(private readonly einvoicing: EInvoicingService) {}

  @Post(":provider")
  @HttpCode(200)
  @ApiOperation({ summary: "Status and incoming-document events from the e-invoicing provider" })
  handle(@Req() req: RawBodyRequest<Request>, @Param("provider") provider: string) {
    return this.einvoicing.handleWebhook(provider, { headers: req.headers, rawBody: req.rawBody?.toString("utf8") ?? "" });
  }
}
