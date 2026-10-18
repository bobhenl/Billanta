import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Ip, NotFoundException, Post, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { visitorIp } from "../guest-invoices/guest-limits";
import { isDemoKind } from "./dataset";
import { demoConfig } from "./demo-config";
import { DemoService } from "./demo.service";
import { ipBucket } from "./ip-bucket";

/**
 * Starts a demo for the frontend's /api/demo/start route, which then opens
 * the session. Not for browsers: only the frontend server knows the shared
 * secret, so a visitor can't skip its CSRF check and rate limit. Uses the
 * pool and the definer functions; there is no tenant context yet.
 */
@ApiExcludeController()
@Controller("v1/public/demo")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Post()
  @HttpCode(201)
  async start(@Body() body: { kind?: unknown; empty?: unknown } | undefined, @Headers("x-demo-provision-secret") secret: string | undefined, @Ip() ip: string, @Req() req: Request) {
    const cfg = demoConfig();
    // Off, or misconfigured: look like a route that doesn't exist.
    if (!cfg.enabled || !cfg.provisionSecret || !cfg.ipSalt) throw new NotFoundException();
    if (!secret || !sameSecret(secret, cfg.provisionSecret)) throw new ForbiddenException("forbidden");
    const kind = body?.kind;
    if (!isDemoKind(kind)) throw new BadRequestException("invalid_kind");
    return this.demo.create(kind, ipBucket(visitorIp(ip, req), cfg.ipSalt), body?.empty === true);
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
