import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { CreatePromoCodeDto, UpdatePromoCodeDto } from "./dto/promo-codes.dto";
import { PromoCodesService } from "./promo-codes.service";

/** Promo code catalogue for Billanta staff (`PLATFORM_ADMIN_EMAILS`). Codes are switched off, never deleted. */
@ApiTags("admin-promo-codes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/promo-codes")
export class AdminPromoCodesController {
  constructor(private readonly promoCodes: PromoCodesService) {}

  @Get()
  @ApiOperation({ summary: "All codes with redemption counts and how many of those companies pay now" })
  list() {
    return this.promoCodes.listAll();
  }

  @Post()
  create(@Body() dto: CreatePromoCodeDto, @Req() req: Request & { user?: { email?: string } }) {
    return this.promoCodes.create(dto, req.user?.email);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePromoCodeDto) {
    return this.promoCodes.update(id, dto);
  }
}
