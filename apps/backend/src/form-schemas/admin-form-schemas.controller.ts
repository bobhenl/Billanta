import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { FormSchemasService } from "./form-schemas.service";

/** EPO form schema watch for Billanta staff (`PLATFORM_ADMIN_EMAILS`). Alerts are in /v1/admin/legislation. */
@ApiTags("admin-form-schemas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/form-schemas")
export class AdminFormSchemasController {
  constructor(private readonly service: FormSchemasService) {}

  @Get()
  @ApiOperation({ summary: "Each EPO form: its XSD, whether our samples pass it, blocked or not" })
  overview() {
    return this.service.overview();
  }

  @Post("check")
  @HttpCode(200)
  @ApiOperation({ summary: "Fetch the XSDs and validate the samples now (e.g. right after a fix)" })
  check() {
    return this.service.runCheck();
  }
}
