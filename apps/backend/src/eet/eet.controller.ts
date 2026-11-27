import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { EetService } from "./eet.service";

const settingsSchema = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(["playground", "production"]),
    idJednotky: z.string().max(9).nullable(),
    idPokl: z.string().max(20).nullable(),
    cardInPerson: z.boolean(),
  })
  .partial()
  .strict();

// A DIS+ .p12 is a few kB; the limit only keeps junk out before decoding.
const certificateSchema = z.object({
  p12: z.string().min(16).max(64 * 1024).regex(/^[A-Za-z0-9+/=\s]+$/),
  password: z.string().min(1).max(256),
});

const listSchema = z.object({ invoiceId: z.string().uuid().optional() });

/**
 * Settings → EET (writes owner/admin only: under `v1/tenants`, see
 * RoleAccessGuard). The records list is readable by members and follows
 * the invoices they may see (member_visibility on eet_records).
 */
@ApiTags("eet")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/tenants/me/eet")
export class EetController {
  constructor(private readonly service: EetService) {}

  @Get()
  @ApiOperation({ summary: "EET settings and the uploaded certificate's public details (never the certificate itself)" })
  get(@Req() req: TenantScopedRequest) {
    return this.service.getSettings(req.tenantDb!, req.user!.tenantId);
  }

  @Put()
  @ApiOperation({ summary: "Switch EET on or off, set the evidenční jednotka, pokladna, environment and whether cards are taken in person" })
  update(@Req() req: TenantScopedRequest, @Body() body: unknown) {
    const parsed = settingsSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("invalid_body");
    return this.service.updateSettings(req.tenantDb!, req.user!.tenantId, parsed.data);
  }

  @Put("certificate")
  @ApiOperation({ summary: "Upload the pokladní certifikát (.p12 as base64) with its password; checked, then stored encrypted" })
  upload(@Req() req: TenantScopedRequest, @Body() body: unknown) {
    const parsed = certificateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_p12");
    return this.service.uploadCertificate(req.tenantDb!, req.user!.tenantId, Buffer.from(parsed.data.p12, "base64"), parsed.data.password);
  }

  @Delete("certificate")
  @ApiOperation({ summary: "Delete the stored certificate (switches EET off)" })
  remove(@Req() req: TenantScopedRequest) {
    return this.service.removeCertificate(req.tenantDb!, req.user!.tenantId);
  }

  @Get("records")
  @ApiOperation({ summary: "EET records, newest first; with invoiceId only those of one document" })
  records(@Req() req: TenantScopedRequest, @Query() query: unknown) {
    const parsed = listSchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException("invalid_query");
    return this.service.listRecords(req.tenantDb!, parsed.data);
  }

  @Post("records/:id/resend")
  @HttpCode(200)
  @ApiOperation({ summary: "Send an unanswered record again now (otherwise the 5-minute retry does it)" })
  resend(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.resend(req.tenantDb!, req.user!.tenantId, id);
  }
}
