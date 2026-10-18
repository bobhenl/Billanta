import { Body, Controller, HttpCode, HttpException, HttpStatus, Ip, Param, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { ProfileMessagesService } from "./profile-messages.service";

/**
 * PUBLIC "Kontaktovat" form on a company profile. Unauthenticated like the
 * order form: rate-limited per visitor, capped per company per day, and 404
 * unless the owner switched the form on.
 */
@ApiTags("public-profile-orders")
@Controller("v1/public/profiles/:slug/messages")
export class ProfileMessagesController {
  private readonly limiter = new SlidingWindowLimiter(60 * 60 * 1000, 5);

  constructor(private readonly messages: ProfileMessagesService) {}

  @Post()
  @HttpCode(204)
  @ApiOperation({
    summary: "Send a message to the company from its public profile",
    description: "Becomes an in-app notification for the company's members; nothing is e-mailed to the visitor. 404 when the form is off, 429 when over the limit.",
  })
  async submit(@Param("slug") slug: string, @Body() body: unknown, @Ip() ip: string, @Req() req: Request): Promise<void> {
    if (!this.limiter.hit(visitorIp(ip, req))) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    await this.messages.submit(slug, body);
  }
}
