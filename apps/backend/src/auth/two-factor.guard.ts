import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";

/**
 * Actions that hand out access to money or data outside Billanta: bank and
 * PayPal connections, API keys, outgoing webhooks, backup destinations.
 * They need a dashboard session that passed two-factor sign-in, so a stolen
 * password (or a hijacked session of a user without 2FA) cannot wire the
 * account to an attacker. Put it after `JwtAuthGuard` on the handler.
 *
 * The frontend shows a "turn on two-factor sign-in" notice on these pages
 * and maps the `two_factor_required` code to the same text.
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TenantScopedRequest>();
    if (req.user?.twoFactor !== true) {
      throw new ForbiddenException("two_factor_required");
    }
    return true;
  }
}
