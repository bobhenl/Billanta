import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PlatformAdminGuard } from "../partners/platform-admin.guard";
import { AccountantDirectoryService } from "./accountant-directory.service";
import { ReviewListingDto } from "./dto";

/** PUBLIC accountant directory behind /accountants. No JWT, no tenant context. */
@ApiTags("public-accountants")
@Controller("v1/public/accountants")
export class PublicAccountantsController {
  constructor(private readonly directory: AccountantDirectoryService) {}

  @Get()
  @ApiOperation({ summary: "Approved accountant listings (`?region=CZ-64`, `?service=vat`)" })
  list(@Query("region") region?: string, @Query("service") service?: string) {
    return this.directory.listPublic({ region, service });
  }
}

/** Review queue for Billanta staff (`PLATFORM_ADMIN_EMAILS`): nothing is listed before approval. */
@ApiTags("admin-accountants")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("v1/admin/accountants")
export class AdminAccountantsController {
  constructor(private readonly directory: AccountantDirectoryService) {}

  @Get()
  @ApiOperation({ summary: "Listings with company name and IČO (`?status=pending`)" })
  list(@Query("status") status?: string) {
    return this.directory.listForReview(status);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Approve or reject one listing (409 listing_changed if it was edited meanwhile)" })
  review(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ReviewListingDto) {
    return this.directory.review(id, dto.status, dto.note, dto.updatedAt);
  }
}
