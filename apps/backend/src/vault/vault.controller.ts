import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequirePlan } from "../billing/plan.guard";
import { MAX_ATTACHMENT_BYTES } from "../invoices/invoice-attachments.service";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import {
  EnableVaultDto,
  MemberWrapDto,
  PlainAttachmentsQueryDto,
  PlainContactsQueryDto,
  PlainInvoicesQueryDto,
  RecoveryWrapDto,
  RekeyInvoiceDto,
  SealContactsDto,
  SealInvoicesDto,
  VaultDocumentsQueryDto,
  VaultSettingsDto,
} from "./dto/vault.dto";
import { encryptedLimit, type UploadedFileLike } from "./sealed-files";
import { VaultService } from "./vault.service";

/**
 * "Důvěrný režim". `v1/vault/me/*` is personal (each member manages their own
 * unlock methods), `v1/vault/invoices/*` is in the invoices area, the rest is
 * company administration (ADMIN_PREFIXES; enabling is owner-only on top).
 */
@ApiTags("vault")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/vault")
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get("me")
  @ApiOperation({ summary: "Whether the mode is on, with the caller's wrapped keys and the recovery wrap" })
  status(@Req() req: TenantScopedRequest) {
    return this.vault.status(req.tenantDb!, req.user!.tenantId, req.user!.id);
  }

  @Post("me/wraps")
  @ApiOperation({ summary: "Set the caller's vault password or add a passkey (the key wrapped in the browser)" })
  addWrap(@Req() req: TenantScopedRequest, @Body() dto: MemberWrapDto) {
    return this.vault.addWrap(req.tenantDb!, req.user!.tenantId, req.user!.id, dto.wrap);
  }

  @Delete("me/wraps/:id")
  @ApiOperation({ summary: "Remove one of the caller's own unlock methods" })
  removeWrap(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.vault.removeWrap(req.tenantDb!, req.user!.tenantId, req.user!.id, id);
  }

  @Post("enable")
  @RequirePlan("confidential_mode")
  @ApiOperation({ summary: "Switch the mode on (owner only, once)" })
  enable(@Req() req: TenantScopedRequest, @Body() dto: EnableVaultDto) {
    return this.vault.enable(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Put("recovery")
  @ApiOperation({ summary: "Replace the recovery code wrap; the old code stops working" })
  replaceRecovery(@Req() req: TenantScopedRequest, @Body() dto: RecoveryWrapDto) {
    return this.vault.replaceRecovery(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Patch("settings")
  @ApiOperation({ summary: "Encrypt new documents by default, and which categories are encrypted" })
  settings(@Req() req: TenantScopedRequest, @Body() dto: VaultSettingsDto) {
    // Turning things off is always allowed, turning them on needs Plus (checked in the service).
    return this.vault.updateSettings(req.tenantDb!, req.user!.tenantId, req.user!, dto);
  }

  @Get("invoices/plain")
  @ApiOperation({ summary: "Unlocked documents that still hold plain text, for the browser to encrypt" })
  plainInvoices(@Req() req: TenantScopedRequest, @Query() query: PlainInvoicesQueryDto) {
    return this.vault.plainInvoices(req.tenantDb!, req.user!.tenantId, query);
  }

  @Get("invoices/documents")
  @ApiOperation({ summary: "Documents with their texts as stored (ciphertext stays ciphertext), for search, suggestions and export in the browser" })
  documents(@Req() req: TenantScopedRequest, @Query() query: VaultDocumentsQueryDto) {
    return this.vault.documents(req.tenantDb!, req.user!.tenantId, req.user!, query);
  }

  @Post("invoices/seal")
  @RequirePlan("confidential_mode")
  @ApiOperation({ summary: "Store texts the browser encrypted (text columns only)" })
  seal(@Req() req: TenantScopedRequest, @Body() dto: SealInvoicesDto) {
    return this.vault.seal(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get("contacts/plain")
  @ApiOperation({ summary: "Plain contacts and buyer snapshots, for the browser to encrypt" })
  plainContacts(@Req() req: TenantScopedRequest, @Query() query: PlainContactsQueryDto) {
    return this.vault.plainContacts(req.tenantDb!, req.user!.tenantId, query);
  }

  @Post("contacts/seal")
  @RequirePlan("confidential_mode")
  @ApiOperation({ summary: "Store the envelopes the browser made of plain contacts" })
  sealContacts(@Req() req: TenantScopedRequest, @Body() dto: SealContactsDto) {
    return this.vault.sealContacts(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get("attachments/plain")
  @ApiOperation({ summary: "Files stored before attachments were encrypted, for the browser to encrypt" })
  plainAttachments(@Req() req: TenantScopedRequest, @Query() query: PlainAttachmentsQueryDto) {
    return this.vault.plainAttachments(req.tenantDb!, req.user!.tenantId, query);
  }

  @Put("attachments/:kind/:id")
  @RequirePlan("confidential_mode")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: encryptedLimit(MAX_ATTACHMENT_BYTES) } }))
  @ApiConsumes("multipart/form-data")
  @ApiOperation({ summary: "Replace a plain file with the ciphertext the browser made from it" })
  sealAttachment(
    @Req() req: TenantScopedRequest,
    @Param("kind") kind: string,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: UploadedFileLike,
    @Body("enc_meta") encMeta?: unknown,
  ) {
    if (kind !== "invoice" && kind !== "expense") throw new BadRequestException({ error: "bad_kind" });
    if (!file) throw new BadRequestException({ error: "no_file" });
    return this.vault.sealAttachment(req.tenantDb!, req.user!.tenantId, kind, id, file, encMeta);
  }

  // No plan check: it only replaces ciphertext with ciphertext, which a
  // downgraded company must still be able to do for documents it already sealed.
  @Post("invoices/:id/rekey")
  @ApiOperation({ summary: "Store one document's texts re-encrypted under its own key, for the client link" })
  rekey(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RekeyInvoiceDto) {
    return this.vault.rekey(req.tenantDb!, req.user!.tenantId, req.user!, id, dto);
  }
}
