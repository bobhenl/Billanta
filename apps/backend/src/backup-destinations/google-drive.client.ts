import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Thin wrapper around Google's OAuth2 token endpoint + Drive v3 upload API,
 * used to refresh a stored refresh token into a short-lived access token and
 * then upload the JSON export bundle into a tenant's chosen Drive folder.
 *
 * ============================================================================
 * CONFIDENCE NOTE — read before treating this as a fully verified
 * integration, same category of caveat this codebase already holds
 * `GopayClient`'s HTTP calls to (`src/billing/gopay.client.ts`).
 * ============================================================================
 * The REQUEST shapes below (`POST https://oauth2.googleapis.com/token` with
 * a `grant_type=refresh_token` form body; `POST
 * https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`
 * with a `multipart/related` body whose first part is a JSON metadata
 * object and second part is the file content, both delimited by a
 * boundary) reflect Google's long-standing, publicly documented OAuth2 and
 * Drive v3 API contracts and have NOT changed in a materially incompatible
 * way across recent years — this is well-established, stable public API
 * surface, not a guess at an obscure or undocumented endpoint (contrast
 * `GopayClient`, which flags genuine uncertainty about an undocumented/
 * inconsistently-documented third-party contract). That said, this was
 * written from documented knowledge of the Google OAuth2/Drive v3 APIs, not
 * exercised against a real Google Cloud project/OAuth client in this task
 * (no live credentials available) — so, honestly: the exact response field
 * names below (`access_token`, `id`) are believed correct with high
 * confidence, but have not been round-tripped against a live API call here.
 * Confirm against https://developers.google.com/identity/protocols/oauth2
 * and https://developers.google.com/drive/api/reference/rest/v3/files/create
 * before depending on this in production, the same way this codebase already
 * asks for GoPay.
 */
@Injectable()
export class GoogleDriveClient {
  constructor(private readonly config: ConfigService) {}

  /**
   * Exchanges a stored refresh token for a fresh, short-lived access token.
   * Refresh tokens obtained via `access_type=offline` do not expire on their
   * own schedule (they're long-lived until revoked), but the access token
   * they mint is only valid for about an hour — so this is called fresh on
   * every export run rather than caching an access token across runs.
   */
  private async getAccessToken(refreshToken: string): Promise<string> {
    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.config.get<string>("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — see .env.example");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Google access-token refresh failed: HTTP ${response.status} — ${body}`);
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new Error("Google access-token refresh response had no access_token field");
    }
    return data.access_token;
  }

  /**
   * Uploads `jsonContent` as a new file named `filename` into `folderId`
   * (Drive's root if `null`) via Drive v3's multipart upload. Always creates
   * a NEW file per run (never overwrites a previous export) — a tenant's
   * backup history is then just "every file in this Drive folder", mirroring
   * the `backup_runs` history table on the webhook side.
   */
  async uploadJsonFile(
    refreshToken: string,
    folderId: string | null,
    filename: string,
    jsonContent: string,
  ): Promise<void> {
    await this.uploadFile(refreshToken, folderId, filename, Buffer.from(jsonContent), "application/json");
  }

  /** Same multipart upload for any file, e.g. an age-encrypted backup. */
  async uploadFile(
    refreshToken: string,
    folderId: string | null,
    filename: string,
    content: Buffer,
    mimeType: string,
  ): Promise<void> {
    const accessToken = await this.getAccessToken(refreshToken);

    const metadata: Record<string, unknown> = { name: filename, mimeType };
    if (folderId) {
      metadata.parents = [folderId];
    }

    const boundary = `faktur-${randomBytes(16).toString("hex")}`;
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Google Drive upload failed: HTTP ${response.status} — ${responseBody}`);
    }
  }
}
