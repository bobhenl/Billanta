import { BadRequestException, Body, Controller, HttpCode, HttpException, HttpStatus, Ip, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isSealed } from "@faktur/cz-compliance";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";

export const vaultDemoEchoSchema = z.object({ envelope: z.string().max(4000) });
export class VaultDemoEchoDto extends createZodDto(vaultDemoEchoSchema) {}

/** What the echo hands back: the body exactly as it arrived, and whether it is an envelope. */
export function demoEcho(body: { envelope: string }, receivedAt = new Date()) {
  if (!isSealed(body.envelope)) throw new BadRequestException("not_sealed");
  return { received: { envelope: body.envelope }, sealed: true, receivedAt: receivedAt.toISOString() };
}

/**
 * The live demo on /security/confidential: the visitor's browser seals a
 * sentence with a throwaway key and posts the envelope here, and the page
 * shows what the server got back. Nothing is stored or logged, only an
 * envelope is accepted (so this is not a free reflector), and a visitor
 * gets 30 tries per 10 minutes.
 */
@ApiTags("public-vault-demo")
@Controller("v1/public/vault-demo")
export class VaultDemoController {
  private readonly limiter = new SlidingWindowLimiter(10 * 60 * 1000, 30);

  @Post("echo")
  @HttpCode(200)
  @ApiOperation({ summary: "Echo an encrypted envelope back, to show what the server receives (not stored)" })
  echo(@Body() dto: VaultDemoEchoDto, @Ip() ip: string, @Req() req: Request) {
    if (!this.limiter.hit(visitorIp(ip, req))) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    return demoEcho(dto);
  }
}
