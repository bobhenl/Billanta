import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { and, asc, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { assertMayDo } from "../tenancy/permissions";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { SendVaultEmailTextsDto } from "../vault/dto/vault.dto";
import { looksLikePdf, VAULT_PDF_MAX_BYTES } from "../vault/vault-email";
import { InvoicesService } from "./invoices.service";

/**
 * "Důvěrný režim": e-mails of encrypted documents waiting for a member's
 * browser to add the PDF (vault/vault-email.ts). Under `v1/vault/invoices`,
 * so the invoices area's permissions apply; sending needs `invoices.send`.
 *
 * The upload is held in memory for the one request and handed to Resend. It
 * is never written to disk, the database or a log.
 */
@ApiTags("vault")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/vault/invoices/emails")
export class VaultEmailQueueController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({ summary: "E-mails of encrypted documents waiting for a browser to add the PDF" })
  async list(@Req() req: TenantScopedRequest) {
    const db = req.tenantDb!;
    const items = await db
      .select({
        id: schema.vaultEmailQueue.id,
        invoiceId: schema.vaultEmailQueue.invoiceId,
        invoiceNumber: schema.invoices.invoiceNumber,
        kind: schema.vaultEmailQueue.kind,
        recipient: schema.vaultEmailQueue.recipient,
        createdAt: schema.vaultEmailQueue.createdAt,
      })
      .from(schema.vaultEmailQueue)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.vaultEmailQueue.invoiceId))
      .where(eq(schema.vaultEmailQueue.status, "waiting"))
      .orderBy(asc(schema.vaultEmailQueue.createdAt))
      .limit(100);
    const [vault] = await db.select({ autoSendPdf: schema.tenantVaults.autoSendPdf }).from(schema.tenantVaults).limit(1);
    return { items, autoSendPdf: vault?.autoSendPdf ?? false };
  }

  @Post(":id/send")
  // No `dest` and no MulterModule config: multer keeps the file in memory only.
  @UseInterceptors(FileInterceptor("pdf", { limits: { fileSize: VAULT_PDF_MAX_BYTES, files: 1 } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { pdf: { type: "string", format: "binary" } }, required: ["pdf"] } })
  @ApiOperation({ summary: "Send a waiting e-mail with the PDF the browser rendered (passes through, not stored)" })
  send(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: { buffer: Buffer; size: number },
  ) {
    assertMayDo(req.user, "invoices.send");
    if (!file?.buffer || !looksLikePdf(file.buffer)) throw new BadRequestException("pdf_required");
    return this.invoices.sendQueuedWithPdf(req.tenantDb!, req.user!.tenantId, req.user!.id, id, { pdf: file.buffer });
  }

  /**
   * The fallback while browsers cannot render the PDF themselves: the member
   * confirms that the decrypted texts pass through the server once, the
   * server prints them in memory and sends. Nothing of them is stored.
   */
  @Post(":id/send-texts")
  @ApiOperation({ summary: "Send a waiting e-mail, printing its PDF from texts the browser decrypted (passes through, not stored)" })
  sendTexts(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SendVaultEmailTextsDto) {
    assertMayDo(req.user, "invoices.send");
    return this.invoices.sendQueuedWithPdf(req.tenantDb!, req.user!.tenantId, req.user!.id, id, { texts: dto.texts });
  }

  @Post(":id/dismiss")
  @ApiOperation({ summary: "Drop a waiting e-mail without sending it" })
  async dismiss(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    assertMayDo(req.user, "invoices.send");
    const [row] = await req
      .tenantDb!.update(schema.vaultEmailQueue)
      .set({ status: "dismissed", doneAt: new Date(), doneBy: req.user!.id })
      .where(and(eq(schema.vaultEmailQueue.id, id), eq(schema.vaultEmailQueue.status, "waiting")))
      .returning({ id: schema.vaultEmailQueue.id });
    if (!row) throw new NotFoundException("vault_email_not_found");
    return { dismissed: true };
  }
}
