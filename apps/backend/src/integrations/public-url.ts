import { lookup as lookupCb, type LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { webhookUrlProblem } from "./webhooks";

/** Loopback, private, link-local, CGNAT, multicast and other non-public ranges. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v6 = address.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

/**
 * `webhookUrlProblem` plus a DNS check: a public-looking name that resolves to
 * an internal address (e.g. `127.0.0.1.nip.io`, a rebinding domain) is refused
 * in production. Run right before every outgoing request, not only on save.
 */
export async function publicUrlProblem(raw: string, production = process.env.NODE_ENV === "production"): Promise<string | null> {
  const problem = webhookUrlProblem(raw, production);
  if (problem || !production) return problem;
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) return "private_host";
  } catch {
    return "unresolvable_host";
  }
  return null;
}

/**
 * A `dns.lookup` replacement for outgoing sockets that fails when the name
 * resolves to any non-public address. `publicUrlProblem` alone is not enough:
 * the connection resolves the name a second time, and a rebinding domain
 * (TTL 0) can answer public for the check and internal for the connect.
 * Validating inside the socket's own lookup closes that gap.
 */
const publicOnlyLookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
  lookupCb(hostname, { ...options, all: true, verbatim: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error(`private_host: ${hostname}`), { code: "EPRIVATEHOST" }));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0]!.address, addresses[0]!.family);
  });
}) as LookupFunction;

/**
 * Resolves `host` once and returns a public address to connect to, so the
 * address that was checked is the one used (non-HTTP clients such as SFTP).
 * Outside production any host is passed through, like `publicUrlProblem`.
 */
export async function resolvePublicHost(host: string, production = process.env.NODE_ENV === "production"): Promise<string> {
  const problem = await publicUrlProblem(`https://${host}`, production);
  if (problem) throw new Error(problem);
  if (!production || isIP(host)) return host;
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new Error("private_host");
  return addresses[0]!.address;
}

/**
 * POSTs `body` to a tenant-supplied URL and resolves with the HTTP status.
 * Runs `publicUrlProblem` first and, in production, pins the connection to a
 * public address via `publicOnlyLookup`. Redirects are never followed.
 */
export async function postToPublicUrl(
  raw: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  production = process.env.NODE_ENV === "production",
): Promise<number> {
  const problem = await publicUrlProblem(raw, production);
  if (problem) throw new Error(problem);
  const url = new URL(raw);
  const request = url.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise<number>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        signal: AbortSignal.timeout(timeoutMs),
        ...(production ? { lookup: publicOnlyLookup } : {}),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
