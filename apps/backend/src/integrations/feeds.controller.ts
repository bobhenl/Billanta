import { Controller, Get, Header, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IntegrationsService } from "./integrations.service";

/**
 * Public, read-only feeds behind a member's secret token (no login — calendar
 * apps and RSS readers can't send one). Rotating the token in Settings →
 * Integrace revokes the old address.
 */
@ApiTags("feeds")
@Controller("v1/feeds")
export class FeedsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get(":token/calendar.ics")
  @Header("content-type", "text/calendar; charset=utf-8")
  @Header("cache-control", "private, max-age=900")
  @ApiOperation({ summary: "iCal feed: tax & insurance deadlines, invoice and bill due dates" })
  calendar(@Param("token") token: string) {
    return this.integrations.calendar(token);
  }

  @Get(":token/invoices.rss")
  @Header("content-type", "application/rss+xml; charset=utf-8")
  @Header("cache-control", "private, max-age=300")
  @ApiOperation({ summary: "RSS feed of the latest issued documents and their status" })
  rss(@Param("token") token: string) {
    return this.integrations.rss(token);
  }
}
