import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
