import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * `purpose` claim baked into the signed `state` JWT (see
 * `BackupDestinationsController.authorizeGoogleDrive` /
 * `GoogleDriveCallbackController.callback`) — a distinguishing marker so the
 * callback only ever trusts a `state` value minted specifically for THIS
 * flow, never some other JWT this app happens to sign for an unrelated
 * purpose that a caller might otherwise be able to replay here. Same
 * "narrow, purpose-tagged token" instinct as `AI_SERVICE_SCOPE` in
 * `tenant-context.middleware.ts`.
 */
export const GOOGLE_DRIVE_OAUTH_STATE_PURPOSE = "backup-destinations-google-drive-oauth";

/**
 * A DIFFERENT OAuth consent flow from NextAuth's own "Log in with Google"
 * (`apps/frontend/auth.ts`), which only ever requests the default
 * `email`/`profile` scopes for authenticating a human sign-in. This flow
 * requests `https://www.googleapis.com/auth/drive.file` (write access to
 * files/folders this app itself creates — NOT full Drive read access) with
 * `access_type=offline&prompt=consent` so Google issues a REFRESH token the
 * background export job can use indefinitely, not just a short-lived access
 * token for the current browser session. Both flows reuse the SAME
 * `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (root `.env.example`) — a single
 * registered Google Cloud OAuth client can request different scopes on
 * different authorization requests; there is no need for a second
 * registered app — but they are otherwise entirely independent: this flow
 * has its own authorize/callback routes
 * (`BackupDestinationsController.authorizeGoogleDrive` /
 * `GoogleDriveCallbackController.callback`) and never touches NextAuth's
 * `accounts`/`sessions` tables.
 *
 * See `google-drive.client.ts`'s doc comment for the confidence caveat that
 * also applies to the token-exchange response shape used here
 * (`exchangeCodeForRefreshToken`).
 */
@Injectable()
export class GoogleDriveOAuthService {
  static readonly SCOPE = "https://www.googleapis.com/auth/drive.file";

  constructor(private readonly config: ConfigService) {}

  /** Must exactly match the redirect URI registered on the Google Cloud OAuth client. */
  callbackUrl(): string {
    const backendUrl = this.config.get<string>("BACKEND_URL") ?? "http://localhost:3000";
    return `${backendUrl}/api/v1/backup-destinations/google-drive/callback`;
  }

  /**
   * Builds the URL to redirect the tenant owner's browser to for Google's
   * consent screen. `state` is an opaque, caller-signed value (see
   * `BackupDestinationsController.authorizeGoogleDrive` — a short-lived JWT
   * carrying the tenant id) that Google echoes back unmodified on the
   * callback request; it is how the callback recovers which tenant initiated
   * the flow, since the callback request itself carries no session/bearer
   * token (it's a plain browser redirect from Google, not an authenticated
   * API call).
   */
  buildAuthorizeUrl(state: string): string {
    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID is not set — see .env.example");
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.callbackUrl(),
      response_type: "code",
      scope: GoogleDriveOAuthService.SCOPE,
      // Required to receive a refresh_token at all (without it, Google only
      // ever returns a short-lived access token).
      access_type: "offline",
      // Forces the consent screen (and a fresh refresh_token) even if the
      // tenant previously authorized this same scope — without it, a repeat
      // authorization can silently return no refresh_token at all (Google
      // only issues one on the FIRST consent for a given client+user+scope
      // combination otherwise).
      prompt: "consent",
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges an authorization `code` (from the callback's `?code=...` query
   * param) for tokens, and returns the refresh token specifically — the only
   * one of the two this app persists (see `encryption.util.ts`); the access
   * token returned alongside it is discarded (a fresh one is minted per
   * export run via `GoogleDriveClient`, since it would be expired by the
   * time a scheduled export actually runs).
   *
   * Throws if Google returns no `refresh_token` at all — the most likely
   * real-world cause is the tenant having previously authorized this exact
   * scope without `prompt=consent` forcing a fresh grant (see
   * `buildAuthorizeUrl`'s comment); this method does not attempt to recover
   * a previously-issued refresh token in that case, it surfaces the failure
   * so the caller can ask the tenant to revoke Faktur's access in their
   * Google Account settings and reconnect.
   */
  async exchangeCodeForRefreshToken(code: string): Promise<string> {
    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.config.get<string>("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — see .env.example");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: this.callbackUrl(),
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google authorization-code exchange failed: HTTP ${response.status} — ${body}`);
    }

    const data = (await response.json()) as { refresh_token?: string };
    if (!data.refresh_token) {
      throw new Error(
        "Google did not return a refresh_token for this authorization — see this method's " +
          "doc comment for the likely cause (a stale prior consent) and how to recover.",
      );
    }
    return data.refresh_token;
  }
}
