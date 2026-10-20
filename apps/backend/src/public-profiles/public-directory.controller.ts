import { Controller, Get, Header, HttpException, HttpStatus, Ip, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PUBLIC_LIST } from "../common/cache-control";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { PublicDirectoryService } from "./public-directory.service";

/** PUBLIC business directory: opted-in public profiles only. No JWT, no tenant context. */
@ApiTags("public-directory")
@Controller("v1/public/directory")
export class PublicDirectoryController {
  // The website fetches the whole list once per revalidate, so a visitor hammering this directly is the only real load.
  private readonly limiter = new SlidingWindowLimiter(10 * 60 * 1000, 600);

  constructor(private readonly directory: PublicDirectoryService) {}

  @Get()
  @Header("Cache-Control", PUBLIC_LIST)
  @ApiOperation({ summary: "Profiles listed in the directory (`?trade=it`, `?town=brno`)" })
  list(@Ip() ip: string, @Req() req: Request, @Query("trade") trade?: string, @Query("town") town?: string) {
    if (!this.limiter.hit(visitorIp(ip, req))) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    return this.directory.list({ trade, town });
  }
}
