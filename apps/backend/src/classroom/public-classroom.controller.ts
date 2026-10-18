import { Body, Controller, ForbiddenException, Headers, HttpCode, NotFoundException, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { timingSafeEqual } from "node:crypto";
import { classroomConfig } from "./classroom-config";
import { ClassroomJoinHandler } from "./join-kind";

/**
 * Joining a class, for the frontend's /join/CODE page and its
 * /api/classroom/* routes, which open the session. Like the demo start,
 * only the frontend server knows the shared secret. Uses the pool and the
 * definer functions; there is no tenant context yet.
 */
@ApiExcludeController()
@Controller("v1/public/classroom")
export class PublicClassroomController {
  constructor(private readonly handler: ClassroomJoinHandler) {}

  @Post("preview")
  @HttpCode(200)
  async preview(@Body() body: { code?: unknown } | undefined, @Headers("x-demo-provision-secret") secret: string | undefined) {
    this.check(secret);
    const preview = typeof body?.code === "string" ? await this.handler.preview(body.code) : null;
    if (!preview) throw new NotFoundException("classroom_not_found");
    return preview;
  }

  @Post("join")
  @HttpCode(201)
  join(@Body() body: { code?: unknown; nickname?: unknown; kind?: unknown } | undefined, @Headers("x-demo-provision-secret") secret: string | undefined) {
    this.check(secret);
    if (typeof body?.code !== "string") throw new NotFoundException("classroom_not_found");
    return this.handler.join(body.code, { nickname: body.nickname, kind: body.kind });
  }

  @Post("reenter")
  @HttpCode(200)
  reenter(@Body() body: { code?: unknown; personalCode?: unknown } | undefined, @Headers("x-demo-provision-secret") secret: string | undefined) {
    this.check(secret);
    return this.handler.reenter(typeof body?.code === "string" ? body.code : "", typeof body?.personalCode === "string" ? body.personalCode : "");
  }

  private check(secret: string | undefined) {
    const cfg = classroomConfig();
    // Off, or misconfigured: look like a route that doesn't exist.
    if (!cfg.enabled || !cfg.provisionSecret || !cfg.codeSecret || !cfg.encryptionKey) throw new NotFoundException();
    if (!secret || !sameSecret(secret, cfg.provisionSecret)) throw new ForbiddenException("forbidden");
  }
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
