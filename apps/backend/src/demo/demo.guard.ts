import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { guardPath } from "../tenancy/role-access.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { classroomBlockFor } from "../classroom/classroom-policy";
import { demoBlockFor } from "./demo-policy";

/**
 * Closes the features a demo company must not use, with codes the frontend
 * can explain, and the extra rules of a class's practice company. Runs
 * after `RoleAccessGuard`; the database triggers of migrations 0068 and
 * 0071 are the backstop.
 */
@Injectable()
export class DemoGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    if (!req.user?.demo) return true;
    const path = guardPath(req.originalUrl ?? req.url ?? "");
    const code =
      demoBlockFor(req.method, path) ?? (req.user.classroom ? classroomBlockFor(req.method, path, req.user.classroomReadOnly === true) : null);
    if (code) throw new ForbiddenException(code);
    return true;
  }
}
