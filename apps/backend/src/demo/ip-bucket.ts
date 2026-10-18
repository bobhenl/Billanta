import { createHash } from "node:crypto";

/**
 * What demo_sessions stores instead of the visitor's address: a salted
 * sha256 of the bucket from `visitorIp()` (IPv4 /32, IPv6 /64). Enough to
 * count demos per network, useless for finding out who it was.
 */
export function ipBucket(bucket: string, salt: string): string {
  return createHash("sha256").update(`${salt}\n${bucket}`).digest("hex");
}
