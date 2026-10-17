import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { utils } from "ssh2";
import SftpClient from "ssh2-sftp-client";
import { resolvePublicHost } from "../integrations/public-url";

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  /** Remote directory; created when missing. */
  path: string;
  privateKey?: string;
  password?: string;
  /** Pinned `SHA256:…` host key, or null to trust (and return) the first one seen. */
  fingerprint: string | null;
}

/** What `config_encrypted` holds for an sftp destination (as JSON). */
export interface SftpSecret {
  privateKey?: string;
  password?: string;
}

/** OpenSSH-style `SHA256:<base64 without padding>` of a raw host key. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** A fresh ed25519 key pair; the public half goes into the server's authorized_keys. */
export function generateSftpKeyPair(): { privateKey: string; publicKey: string } {
  const pair = utils.generateKeyPairSync("ed25519", { comment: "billanta-backup" });
  return { privateKey: pair.private, publicKey: pair.public };
}

/** Joins the remote directory and file name without doubling slashes. */
export function remoteFilePath(dir: string, filename: string): string {
  const clean = dir.trim().replace(/\/+$/, "");
  return clean ? `${clean}/${filename}` : filename;
}

/**
 * Uploads one backup file to the company's own SFTP server. The host must be
 * public (same rule as backup webhooks) and its key must match the pinned
 * fingerprint; on the first run the seen fingerprint is returned for pinning.
 */
@Injectable()
export class SftpBackupClient {
  async upload(target: SftpTarget, filename: string, content: Buffer): Promise<{ fingerprint: string }> {
    // Connect to the address that passed the public check, not the name:
    // resolving twice would let a rebinding domain point the socket inward.
    let address: string;
    try {
      address = await resolvePublicHost(target.host);
    } catch (err) {
      throw new Error(`SFTP host refused: ${(err as Error).message}`);
    }

    let seen: string | null = null;
    const client = new SftpClient("billanta-backup");
    try {
      await client.connect({
        host: address,
        port: target.port,
        username: target.username,
        ...(target.password ? { password: target.password } : { privateKey: target.privateKey }),
        readyTimeout: 20_000,
        hostVerifier: (key: Buffer) => {
          seen = hostKeyFingerprint(key);
          return target.fingerprint === null || target.fingerprint === seen;
        },
      });
    } catch (err) {
      if (seen && target.fingerprint && seen !== target.fingerprint) {
        throw new Error(`SFTP host key changed (expected ${target.fingerprint}, got ${seen})`);
      }
      throw new Error(`SFTP connection failed: ${(err as Error).message}`);
    }
    try {
      const dir = target.path.trim().replace(/\/+$/, "");
      if (dir && !(await client.exists(dir))) await client.mkdir(dir, true);
      await client.put(content, remoteFilePath(dir, filename));
    } finally {
      await client.end().catch(() => undefined);
    }
    return { fingerprint: seen ?? target.fingerprint ?? "" };
  }
}
