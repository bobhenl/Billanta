import { Body, Controller, ForbiddenException, Headers, HttpCode, HttpException, HttpStatus, Ip, NotFoundException, Post, Req } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { ipBucket } from "../demo/ip-bucket";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { classroomConfig } from "./classroom-config";
import { ClassroomJoinHandler } from "./join-kind";

/**
 * Joining a class, for the frontend's /join/CODE page and its
 * /api/classroom/* routes, which open the session. Like the demo start,
 * only the frontend server knows the shared secret. Uses the pool and the
 * definer functions; there is no tenant context yet.
 *
 * The frontend limits per visitor too; these limits are the backstop for a
 * leaked secret or a frontend bug. They are loose, because a whole class
 * joins from one school IP within minutes.
 */
@ApiExcludeController()
@Controller("v1/public/classroom")
export class PublicClassroomController {
  private readonly previewLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 300);
  private readonly joinLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 100);
  private readonly reenterLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 80);

  constructor(private readonly handler: ClassroomJoinHandler) {}

  @Post("preview")
  @HttpCode(200)
  async preview(
    @Body() body: { code?: unknown } | undefined,
    @Headers("x-demo-provision-secret") secret: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    this.check(secret);
    this.throttle(this.previewLimiter, visitorIp(ip, req));
    const preview = typeof body?.code === "string" ? await this.handler.preview(body.code) : null;
    if (!preview) throw new NotFoundException("classroom_not_found");
    return preview;
  }

  @Post("join")
  @HttpCode(201)
  join(
    @Body() body: { code?: unknown; nickname?: unknown; kind?: unknown } | undefined,
    @Headers("x-demo-provision-secret") secret: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    this.check(secret);
    this.throttle(this.joinLimiter, visitorIp(ip, req));
    if (typeof body?.code !== "string") throw new NotFoundException("classroom_not_found");
    return this.handler.join(body.code, { nickname: body.nickname, kind: body.kind });
  }

  @Post("reenter")
  @HttpCode(200)
  reenter(
    @Body() body: { code?: unknown; personalCode?: unknown } | undefined,
    @Headers("x-demo-provision-secret") secret: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    this.check(secret);
    const visitor = visitorIp(ip, req);
    this.throttle(this.reenterLimiter, visitor);
    return this.handler.reenter(typeof body?.code === "string" ? body.code : "", typeof body?.personalCode === "string" ? body.personalCode : "", {
      ipBucket: ipBucket(visitor, classroomConfig().ipSalt),
    });
  }

  private check(secret: string | undefined) {
    const cfg = classroomConfig();
    // Off, or misconfigured: look like a route that doesn't exist.
    if (!cfg.enabled || !cfg.provisionSecret || !cfg.codeSecret || !cfg.encryptionKey) throw new NotFoundException();
    if (!secret || !sameSecret(secret, cfg.provisionSecret)) throw new ForbiddenException("forbidden");
  }

  private throttle(limiter: SlidingWindowLimiter, visitor: string) {
    if (!limiter.hit(visitor)) throw new HttpException("rate_limited", HttpStatus.TOO_MANY_REQUESTS);
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
