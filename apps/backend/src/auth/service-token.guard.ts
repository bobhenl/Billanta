import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { verifyBearerToken } from "./verify-bearer-token";

/** Scope claim carried only by the AI microservice's `BACKEND_SERVICE_JWT`. */
export const AI_SERVICE_SCOPE = "ai-service";

/**
 * Admits only the AI microservice. A signed-in dashboard user's JWT is valid
 * too, but must never resolve or activate channel links for arbitrary
 * Telegram/WhatsApp senders, so a token without the service scope is a 403.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const identity = verifyBearerToken(this.jwtService, req.headers.authorization);
    if (identity.scope !== AI_SERVICE_SCOPE) throw new ForbiddenException("Service credential required");
    return true;
  }
}
