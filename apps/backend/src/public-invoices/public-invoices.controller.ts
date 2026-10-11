import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PublicInvoicesService } from "./public-invoices.service";

/**
 * PUBLIC, unauthenticated client-portal endpoint. A client clicking an
 * emailed invoice link has no session, no JWT, and no tenant context — so,
 * like `ChannelLinksController`'s `verify` route (see `AppModule.configure`'s
 * comment on `TenantContextMiddleware.forRoutes(...)`), this controller is
 * deliberately:
 *   - NOT decorated with `@UseGuards(JwtAuthGuard)` — there is no bearer
 *     token to check, and requiring one would defeat the entire point of a
 *     no-auth client portal;
 *   - NOT listed in `TenantContextMiddleware.forRoutes(...)` in
 *     `app.module.ts` — there is no tenant to resolve `req.tenantDb`
 *     against yet, and `PublicInvoicesService` never touches `req.tenantDb`
 *     in the first place. Every read instead goes through one of the three
 *     narrow `SECURITY DEFINER` SQL functions in `drizzle/rls-policies.sql`
 *     keyed on the invoice's unguessable `public_token`.
 *
 * Deliberately kept in its own module/controller rather than added as a
 * route on the tenant-scoped `InvoicesController` — so the "this is a
 * public, unauthenticated surface" fact is visible from the module
 * boundary itself, not just from a middleware exclude-list entry (or a
 * missing `@UseGuards`) someone could overlook later while editing
 * `InvoicesController` for an unrelated reason.
 */
@ApiTags("public-invoices")
@Controller("v1/public/invoices")
export class PublicInvoicesController {
  constructor(private readonly publicInvoicesService: PublicInvoicesService) {}

  @Get(":token")
  @ApiOperation({
    summary: "Get a client-portal view of an invoice by its public token",
    description:
      "No authentication required. `token` is the invoice's unguessable `public_token` " +
      "(see `invoices.publicToken` in `drizzle/schema.ts`) — the id embedded in the " +
      "shareable link a client is sent, distinct from the invoice's internal `id`. " +
      "Returns 404 for both an unmatched and a malformed token (never a different error " +
      "shape that would let a caller distinguish the two). Only fields explicitly reviewed " +
      "as safe for an external client are returned — see the `get_public_invoice_view` / " +
      "`get_public_invoice_line_items` / `get_public_invoice_supplier_info` SECURITY DEFINER " +
      "functions in `drizzle/rls-policies.sql` for exactly what is excluded (AI-draft " +
      "transcript/extraction metadata, the liability audit trail, dunning bookkeeping, " +
      "every other tenant's data, and every `tenants` column beyond company name + bank " +
      "account).",
  })
  findByToken(@Param("token") token: string) {
    return this.publicInvoicesService.findByPublicToken(token);
  }
}
