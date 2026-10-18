import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { LegislationService } from "./legislation.service";

/** PUBLIC: "last checked" dates shown next to the tax guides and the VAT filing help. */
@ApiTags("public-legislation")
@Controller("v1/public/legislation")
export class PublicLegislationController {
  constructor(private readonly service: LegislationService) {}

  @Get("checked")
  @Header("Cache-Control", "public, max-age=3600")
  @ApiOperation({ summary: "Per-dataset date (YYYY-MM-DD) of the last confirmed check, null if none" })
  checked() {
    return this.service.checkedDates();
  }
}
