import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClientPortalService } from "./client-portal.service";

/**
 * PUBLIC, unauthenticated per-customer portal — same reasoning as
 * `PublicInvoicesController`: no JWT guard, no tenant middleware, every read
 * goes through the `get_client_portal*` SECURITY DEFINER functions keyed on
 * the customer's unguessable `contacts.portal_token`.
 */
@ApiTags("public-invoices")
@Controller("v1/public/portal")
export class ClientPortalController {
  constructor(private readonly clientPortalService: ClientPortalService) {}

  @Get(":token")
  @ApiOperation({
    summary: "List a customer's issued documents by their portal token",
    description: "No authentication required. 404 for an unknown, revoked or malformed token, or a suspended company.",
  })
  find(@Param("token") token: string) {
    return this.clientPortalService.find(token);
  }
}
