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
      throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set – see .env.example");
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
      throw new Error(`Google access-token refresh failed: HTTP ${response.status} – ${body}`);
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
      throw new Error(`Google Drive upload failed: HTTP ${response.status} – ${responseBody}`);
    }
  }

  /**
   * One access token and a folder cache for many files (the document
   * archive): `put("Billanta/2026/vydane/2026-0001.pdf", …)` finds or creates
   * each folder under `rootFolderId` (Drive's root when null). With the
   * `drive.file` scope only folders this app created are visible, which is
   * exactly the ones it looks for. A known `remoteId` replaces that file's
   * content, so a changed document does not appear twice.
   */
  async openSession(refreshToken: string, rootFolderId: string | null): Promise<DriveSession> {
    let token = await this.getAccessToken(refreshToken);
    const folders = new Map<string, string>();

    const call = async (url: string, init: RequestInit): Promise<Response> => {
      const send = () => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      let res = await send();
      if (res.status === 401) {
        token = await this.getAccessToken(refreshToken);
        res = await send();
      }
      return res;
    };

    const folderId = async (segments: string[]): Promise<string | null> => {
      let parent = rootFolderId;
      for (let i = 0; i < segments.length; i++) {
        const key = segments.slice(0, i + 1).join("/");
        const cached = folders.get(key);
        if (cached) {
          parent = cached;
          continue;
        }
        const q = [
          `name = '${driveQueryString(segments[i])}'`,
          `'${driveQueryString(parent ?? "root")}' in parents`,
          "mimeType = 'application/vnd.google-apps.folder'",
          "trashed = false",
        ].join(" and ");
        const found = await call(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`, { method: "GET" });
        if (!found.ok) throw new Error(`Google Drive folder lookup failed: HTTP ${found.status} – ${await found.text()}`);
        let id = ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id;
        if (!id) {
          const created = await call("https://www.googleapis.com/drive/v3/files?fields=id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: segments[i], mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }),
          });
          if (!created.ok) throw new Error(`Google Drive folder create failed: HTTP ${created.status} – ${await created.text()}`);
          id = ((await created.json()) as { id: string }).id;
        }
        folders.set(key, id);
        parent = id;
      }
      return parent;
    };

    return {
      put: async (path, content, mimeType, remoteId) => {
        if (remoteId) {
          const res = await call(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(remoteId)}?uploadType=media&fields=id`, {
            method: "PATCH",
            headers: { "Content-Type": mimeType },
            body: content,
          });
          if (res.ok) return { remoteId };
          // Deleted or trashed by the owner: upload it again as a new file.
          if (res.status !== 404) throw new Error(`Google Drive update failed: HTTP ${res.status} – ${await res.text()}`);
        }
        const segments = path.split("/");
        const name = segments.pop()!;
        const parent = await folderId(segments);
        const { body, contentType } = multipartBody({ name, mimeType, ...(parent ? { parents: [parent] } : {}) }, content, mimeType);
        const res = await call("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
          method: "POST",
          headers: { "Content-Type": contentType },
          body,
        });
        if (!res.ok) throw new Error(`Google Drive upload failed: HTTP ${res.status} – ${await res.text()}`);
        return { remoteId: ((await res.json()) as { id: string }).id };
      },
    };
  }
}

export interface DriveSession {
  put(path: string, content: Buffer, mimeType: string, remoteId: string | null): Promise<{ remoteId: string | null }>;
}

/** A literal inside a Drive `q` string: backslash and quote escaped. */
export function driveQueryString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function multipartBody(metadata: Record<string, unknown>, content: Buffer, mimeType: string) {
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
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}
