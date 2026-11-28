import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from "@nestjs/common";
import { map } from "rxjs";

/**
 * What an `sk_live_` key may not do even with the right scopes: anything
 * that changes an issued document, deletes, or hands out the client link.
 * A leaked key should only ever cost drafts, never the books. The AI
 * service JWT is also role "service" but has no `apiKey` flag, so it is
 * not affected.
 */
export function refuseApiKey(user: { apiKey?: boolean } | undefined) {
  if (user?.apiKey) throw new ForbiddenException({ error: "not_available_via_api_key" });
}

/** Client links (bearer secrets for the buyer) and sealed columns: a key has no use for them. */
const SECRET_KEYS = new Set(["publicToken", "publicKey", "publicSlug", "portalToken", "buyerDetailsToken", "feedToken"]);
export const isSecretKey = (key: string) => SECRET_KEYS.has(key) || key.endsWith("Encrypted");

/** Drops secret keys from plain JSON; leaves Dates, Buffers and streams alone. */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    // `links` of the detail are the copy-link paths built from the token.
    if (isSecretKey(key) || key === "links") continue;
    out[key] = withoutSecrets(v);
  }
  return out;
}

/** Applies `withoutSecrets` to every response of an API-key request. */
@Injectable()
export class ApiKeySecretsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const user = context.switchToHttp().getRequest<{ user?: { apiKey?: boolean } }>().user;
    return user?.apiKey ? next.handle().pipe(map(withoutSecrets)) : next.handle();
  }
}
