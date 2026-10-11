import { BadRequestException, Controller, Get, Logger, Query, Res, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Response } from "express";
import { BackupDestinationsService } from "./backup-destinations.service";
import {
  GOOGLE_DRIVE_OAUTH_STATE_PURPOSE,
  GoogleDriveOAuthService,
} from "./google-drive-oauth.service";

interface GoogleDriveOAuthState {
  tenantId: string;
  purpose: string;
}

/**
 * Handles Google's redirect back after the tenant owner grants (or denies)
 * consent on `BackupDestinationsController.authorizeGoogleDrive`'s consent
 * screen.
 *
 * ============================================================================
 * DELIBERATELY A SEPARATE CONTROLLER CLASS, NOT A ROUTE ON
 * `BackupDestinationsController` — same "pre-tenant-context" shape
 * `ChannelLinksController`/`PublicInvoicesController` already carve out for
 * themselves (see `app.module.ts`'s `configure()` doc comment).
 * ============================================================================
 * Google's redirect is a plain browser GET request — it carries no
 * `Authorization` bearer token and no `X-Tenant-Id` header, because the
 * browser is following a URL Google generated, not calling this API as an
 * authenticated dashboard client. `TenantContextMiddleware` unconditionally
 * requires a verifiable bearer JWT (see its own doc comment on why a guard
 * alone can never "catch" a differently-shaped request in time), so this
 * controller must NOT be included in `TenantContextMiddleware.forRoutes(...)`
 * — it is registered as its own controller class specifically so it is
 * structurally impossible to accidentally list it there. Tenant identity for
 * this request instead comes entirely from the signed `state` JWT minted by
 * `authorizeGoogleDrive` (see `GOOGLE_DRIVE_OAUTH_STATE_PURPOSE`'s doc
 * comment) — verified below via the same global `JwtService` every other
 * bearer-token check in this app uses, just carried in a query param instead
 * of a header.
 */
@Controller("v1/backup-destinations/google-drive")
export class GoogleDriveCallbackController {
  private readonly logger = new Logger(GoogleDriveCallbackController.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly googleDriveOAuthService: GoogleDriveOAuthService,
    private readonly backupDestinationsService: BackupDestinationsService,
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      // The tenant owner declined consent on Google's screen, or Google
      // itself reported an error — not a bug in this app. Redirect back to
      // the settings page with an indicator rather than rendering a raw
      // JSON error for what is fundamentally a browser navigation.
      this.logger.warn(`Google Drive OAuth consent declined/errored: ${error}`);
      res.redirect(this.frontendSettingsUrl("error", error));
      return;
    }

    if (!code || !state) {
      throw new BadRequestException("Missing code or state in Google OAuth callback");
    }

    const payload = this.verifyState(state);

    const refreshToken = await this.googleDriveOAuthService.exchangeCodeForRefreshToken(code);
    await this.backupDestinationsService.createOrReplaceGoogleDriveDestination(
      payload.tenantId,
      refreshToken,
    );

    res.redirect(this.frontendSettingsUrl("connected", "google_drive"));
  }

  /**
   * Verifies the `state` value is a genuine, unexpired JWT signed by THIS
   * app (same `JwtService`/`JWT_SECRET` as every other bearer token) AND
   * carries the exact `purpose` claim `authorizeGoogleDrive` stamped it
   * with — rejecting any other validly-signed-but-differently-purposed JWT
   * this app might issue elsewhere (see `GOOGLE_DRIVE_OAUTH_STATE_PURPOSE`'s
   * doc comment).
   */
  private verifyState(state: string): GoogleDriveOAuthState {
    let payload: unknown;
    try {
      payload = this.jwtService.verify(state, { algorithms: ["HS256"] });
    } catch {
      throw new UnauthorizedException("Invalid or expired OAuth state");
    }

    if (typeof payload !== "object" || payload === null) {
      throw new UnauthorizedException("Malformed OAuth state");
    }
    const record = payload as Record<string, unknown>;
    if (
      typeof record.tenantId !== "string" ||
      record.purpose !== GOOGLE_DRIVE_OAUTH_STATE_PURPOSE
    ) {
      throw new UnauthorizedException("OAuth state was not issued for this flow");
    }

    return { tenantId: record.tenantId, purpose: record.purpose };
  }

  /**
   * Deliberately an UNPREFIXED path (`/settings/backup`, not
   * `/cs/settings/backup`) — this backend has no reliable way to know the
   * tenant's UI locale preference at this point, and `apps/frontend`'s
   * `next-intl` middleware (`localePrefix: 'always'`,
   * `defaultLocale: 'cs'`) already redirects any unprefixed path to the
   * default locale's prefixed equivalent, preserving the query string — so
   * this resolves correctly without this backend needing to duplicate that
   * locale-resolution logic.
   */
  private frontendSettingsUrl(param: "connected" | "error", value: string): string {
    const siteUrl = this.config.get<string>("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3001";
    return `${siteUrl}/settings/backup?${param}=${encodeURIComponent(value)}`;
  }
}
