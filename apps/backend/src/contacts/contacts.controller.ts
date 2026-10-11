import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";

@ApiTags("contacts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/contacts")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  @ApiOperation({ summary: "List contacts for the current tenant" })
  list(@Req() req: TenantScopedRequest) {
    return this.contactsService.list(req.tenantDb!);
  }

  @Post()
  @ApiOperation({ summary: "Create a contact" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateContactDto) {
    return this.contactsService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a contact by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.contactsService.findOne(req.tenantDb!, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a contact (TODO: not yet implemented)" })
  update() {
    return this.contactsService.update();
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete a contact (TODO: not yet implemented)" })
  remove() {
    return this.contactsService.remove();
  }

  /**
   * Implied dependency, not part of this scaffold's original brief:
   * `apps/ai-service`'s `enrich_with_ares()` already calls
   * `POST /api/v1/contacts/ares-lookup` (see its docstring) expecting the
   * backend to own ARES lookups via `@faktur/cz-compliance`. Stubbed here
   * purely so the integration surface is visible; not implemented.
   */
  @Post("ares-lookup")
  @ApiOperation({ summary: "ARES registry lookup (TODO: not yet implemented)" })
  aresLookup() {
    return this.contactsService.aresLookup();
  }
}
