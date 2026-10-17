import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreatePartnerDto, UpdatePartnerDto } from "./dto/partners.dto";
import { PartnersService } from "./partners.service";
import { PlatformAdminGuard } from "./platform-admin.guard";

/** Partners catalogue management for Billanta staff (`PLATFORM_ADMIN_EMAILS`). */
@ApiTags("admin-partners")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/partners")
export class AdminPartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @ApiOperation({ summary: "All partners including inactive ones, with click counts" })
  list() {
    return this.partners.listAll();
  }

  @Post()
  create(@Body() dto: CreatePartnerDto) {
    return this.partners.create(dto);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdatePartnerDto) {
    return this.partners.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.partners.remove(id);
  }
}
