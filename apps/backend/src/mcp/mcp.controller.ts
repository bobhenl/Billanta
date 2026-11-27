import { Body, Controller, Delete, Get, Headers, Logger, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Response } from "express";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { BankReconciliationService } from "../bank-reconciliation/bank-reconciliation.service";
import { ContactsService } from "../contacts/contacts.service";
import { DashboardService } from "../dashboard/dashboard.service";
import { ExpensesService } from "../expenses/expenses.service";
import { InvoiceTemplatesService } from "../invoice-templates/invoice-templates.service";
import { InvoicesService } from "../invoices/invoices.service";
import { TenantsService } from "../tenants/tenants.service";
import { handleMessage, MCP_PROTOCOL_VERSIONS, RPC, type JsonRpcRequest, type JsonRpcResponse } from "./mcp-protocol";
import type { McpContext, McpServices } from "./mcp-tools";

/**
 * Remote MCP server for AI assistants (Claude, Cursor, …), authenticated with
 * the company's own `sk_live_` API key. ApiKeyOrJwtTenantContextMiddleware
 * (AppModule) has already checked the key and opened the tenant's RLS
 * transaction; the key's scope is checked per tool (src/mcp/mcp-tools.ts).
 * Stateless Streamable HTTP: every POST stands alone, answers are JSON, and
 * there is no SSE stream to GET.
 */
@ApiExcludeController()
@Controller("v1/mcp")
export class McpController {
  private readonly logger = new Logger(McpController.name);
  private readonly services: McpServices;

  constructor(
    tenants: TenantsService,
    invoices: InvoicesService,
    contacts: ContactsService,
    expenses: ExpensesService,
    bank: BankReconciliationService,
    templates: InvoiceTemplatesService,
    dashboard: DashboardService,
  ) {
    this.services = { tenants, invoices, contacts, expenses, bank, templates, dashboard };
  }

  @Post()
  async post(
    @Req() req: TenantScopedRequest,
    @Res() res: Response,
    @Body() body: unknown,
    @Headers("mcp-protocol-version") version?: string,
  ): Promise<void> {
    // Dashboard sessions and the AI service have their own APIs; this one is for keys only.
    if (!req.user?.apiKey || !req.tenantDb) {
      res.status(401).json({ error: "api_key_required", message: "Use a Billanta API key: Authorization: Bearer sk_live_..." });
      return;
    }
    if (version !== undefined && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
      res.status(400).json({ error: "unsupported_protocol_version", supported: MCP_PROTOCOL_VERSIONS });
      return;
    }

    const ctx: McpContext = { db: req.tenantDb, user: req.user, services: this.services };
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as JsonRpcRequest[];
    if (messages.length === 0) {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: RPC.invalidRequest, message: "Invalid Request" } });
      return;
    }

    const responses: JsonRpcResponse[] = [];
    for (const msg of messages) {
      try {
        const answer = await handleMessage(ctx, msg);
        if (answer) responses.push(answer);
      } catch (error) {
        this.logger.error(`MCP call failed: ${(error as Error)?.message ?? error}`);
        const id = msg && typeof msg === "object" && (typeof msg.id === "string" || typeof msg.id === "number") ? msg.id : null;
        responses.push({ jsonrpc: "2.0", id, error: { code: RPC.internal, message: "Internal error" } });
      }
    }

    // Only notifications (e.g. notifications/initialized): accepted, nothing to say.
    if (responses.length === 0) {
      res.status(202).end();
      return;
    }
    res.status(200).json(batch ? responses : responses[0]);
  }

  @Get()
  get(@Res() res: Response): void {
    res.status(405).set("Allow", "POST").json({ error: "method_not_allowed", message: "This MCP server is stateless: send JSON-RPC with POST." });
  }

  @Delete()
  delete(@Res() res: Response): void {
    res.status(405).set("Allow", "POST").json({ error: "method_not_allowed" });
  }
}
