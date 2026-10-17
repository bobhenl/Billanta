import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { COMPANY_REGISTRIES, ContactsService, type CompanyRegistry } from "./contacts.service";
import { AresLookupDto } from "./dto/ares-lookup.dto";
import { CreateContactDto } from "./dto/create-contact.dto";
import { StarContactDto } from "./dto/star-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024;

/** multer `MemoryStorage` file shape — see the same type in `bank-reconciliation.controller.ts`. */
interface UploadedCsvFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

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

  // Declared before `:id` so "search" is never captured as an id.
  @Get("search")
  @ApiOperation({ summary: "Customer typeahead: own contacts + a company register (ARES/RPO, FR, NO, PL or EU VIES)" })
  search(@Req() req: TenantScopedRequest, @Query("q") q = "", @Query("registry") registry = "auto") {
    const picked = (COMPANY_REGISTRIES as readonly string[]).includes(registry) ? (registry as CompanyRegistry) : "auto";
    return this.contactsService.search(req.tenantDb!, q, picked);
  }

  @Get("vat-check")
  @ApiOperation({ summary: "VAT registration of a DIČ: CZ register of VAT payers (ADIS, incl. unreliable payer and published accounts), VIES for other EU states" })
  vatCheck(@Query("dic") dic = "") {
    return this.contactsService.vatCheck(dic);
  }

  @Get("addresses")
  @ApiOperation({ summary: "Address typeahead: RÚIAN via ARES for CZ, OpenStreetMap (Photon) for other countries" })
  addresses(@Query("q") q = "", @Query("country") country = "CZ") {
    return this.contactsService.searchAddresses(q, country);
  }

  @Get("starred")
  @ApiOperation({ summary: "Starred customers (quick picks for a new invoice)" })
  starred(@Req() req: TenantScopedRequest) {
    return this.contactsService.starred(req.tenantDb!);
  }

  @Get("export.csv")
  @ApiOperation({ summary: "All contacts as a Czech-Excel CSV (`;`, UTF-8 BOM) that re-imports as-is" })
  async exportCsv(@Req() req: TenantScopedRequest, @Res() res: Response) {
    const body = await this.contactsService.exportCsv(req.tenantDb!);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="kontakty-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(body);
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_SIZE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiOperation({
    summary: "Import contacts from CSV (ours, faktorio, Fakturoid or hand-made; matched by IČO, then name)",
  })
  importCsv(@Req() req: TenantScopedRequest, @UploadedFile() file?: UploadedCsvFile) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    return this.contactsService.importCsv(req.tenantDb!, req.user!.tenantId, file.buffer);
  }

  @Put(":id/star")
  @ApiOperation({ summary: "Star or unstar a contact" })
  star(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: StarContactDto) {
    return this.contactsService.setStarred(req.tenantDb!, id, dto.starred);
  }

  @Post(":id/portal")
  @ApiOperation({ summary: "Turn on the customer's client portal, or issue a new link (the old one stops working)" })
  enablePortal(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.contactsService.setPortal(req.tenantDb!, id, true);
  }

  @Delete(":id/portal")
  @ApiOperation({ summary: "Turn off the customer's client portal" })
  disablePortal(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.contactsService.setPortal(req.tenantDb!, id, false);
  }

  @Post()
  @ApiOperation({ summary: "Create a contact" })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateContactDto) {
    return this.contactsService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get(":id/summary")
  @ApiOperation({ summary: "Hover-card aggregates for a contact: invoice count, totals per currency, unpaid/overdue, last invoice date" })
  summary(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.contactsService.summary(req.tenantDb!, req.user!.tenantId, id);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a contact by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.contactsService.findOne(req.tenantDb!, id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a contact (partial; null clears an optional field)" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(req.tenantDb!, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Delete a contact (409 contact_in_use when documents reference it)" })
  remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.contactsService.remove(req.tenantDb!, id);
  }

  /**
   * `apps/ai-service`'s `enrich_with_ares()` already calls
   * `POST /api/v1/contacts/ares-lookup` (see its docstring) expecting the
   * backend to own ARES lookups via `@faktur/cz-compliance`. Cache-first
   * (24h TTL against the global, non-tenant-scoped `ares_cache` table) —
   * see `ContactsService.aresLookup`'s doc comment. 404s for an unknown
   * IČO rather than returning an empty/null body.
   */
  @Post("ares-lookup")
  @ApiOperation({
    summary: "Look up a company in the ARES registry by IČO",
    description:
      "Cache-first (24h TTL, ares_cache table) against ARES via @faktur/cz-compliance. " +
      "Returns 404 if the IČO doesn't resolve to a registered subject.",
  })
  aresLookup(@Body() dto: AresLookupDto) {
    return this.contactsService.lookupById(dto.ico, dto.country);
  }
}
