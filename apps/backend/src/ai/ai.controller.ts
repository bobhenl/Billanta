import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { AiService, RECEIPT_MEDIA_TYPES, type ReceiptMediaType } from "./ai.service";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
import { InvoiceSuggestionDto } from "./dto/invoice-suggestion.dto";
import { UpdateAiSettingsDto } from "./dto/update-ai-settings.dto";

/**
 * Settings are dashboard-only (JWT). The suggestion endpoint is also part of
 * the public API: an `sk_live_...` key may call it, and it runs on that
 * tenant's AI mode — their own Anthropic key, or Billanta's within the daily
 * limit. Tenant context for API keys comes from
 * ApiKeyOrJwtTenantContextMiddleware (registered for this controller in
 * AppModule), same as the invoices API.
 */
@ApiTags("ai")
@ApiBearerAuth()
@Controller("v1/ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get("settings")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "AI mode for this tenant (off / Billanta key / own key); never returns the key" })
  getSettings(@Req() req: TenantScopedRequest) {
    return this.aiService.getSettings(req.tenantDb!, req.user!.tenantId);
  }

  @Put("settings")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Change AI mode and/or set or remove the tenant's own Anthropic API key (owner/admin)" })
  updateSettings(@Req() req: TenantScopedRequest, @Body() dto: UpdateAiSettingsDto) {
    return this.aiService.updateSettings(req.tenantDb!, req.user!.tenantId, req.user!.role, dto);
  }

  @Post("invoice-suggestion")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary: "Free-text description -> pre-filled invoice fields (nothing is saved)",
    description:
      "Accepts a dashboard JWT or a public-API key (Authorization: Bearer sk_live_...). " +
      "Uses the tenant's AI mode: its own Anthropic key, or Billanta's key within the daily limit.",
  })
  suggestInvoice(@Req() req: TenantScopedRequest, @Body() dto: InvoiceSuggestionDto) {
    return this.aiService.suggestInvoice(req.tenantDb!, req.user!.tenantId, dto.text);
  }

  @Post("receipt")
  @UseGuards(CombinedAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] },
  })
  @ApiOperation({
    summary: "Photo or PDF of a received invoice -> pre-filled expense fields (nothing is saved)",
    description: "JPEG, PNG, WebP, GIF or PDF up to 10 MB, multipart field \"file\".",
  })
  readReceipt(
    @Req() req: TenantScopedRequest,
    @UploadedFile() file?: { mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    if (!(RECEIPT_MEDIA_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException({ error: "unsupported_file_type" });
    }
    return this.aiService.readReceipt(req.tenantDb!, req.user!.tenantId, {
      buffer: file.buffer,
      mediaType: file.mimetype as ReceiptMediaType,
    });
  }
}
