import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { guardPath } from "../tenancy/role-access.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { demoBlockFor } from "./demo-policy";

/**
 * Closes the features a demo company must not use, with codes the frontend
 * can explain. Runs after `RoleAccessGuard`; the database triggers of
 * migration 0068 are the backstop.
 */
@Injectable()
export class DemoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    if (!req.user?.demo) return true;
    const code = demoBlockFor(req.method, guardPath(req.originalUrl ?? req.url ?? ""));
    if (code) throw new ForbiddenException(code);
    return true;
  }
}
