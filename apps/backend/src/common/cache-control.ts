import type { NextFunction, Request, Response } from "express";

/**
 * Cache-Control for the API, set on every response before the route runs.
 *
 * Express sends no Cache-Control at all, and a response without one lets a
 * shared cache (Cloudflare with a broad cache rule, a corporate proxy) pick
 * its own lifetime by heuristic. For an API whose answers are a tenant's
 * invoices and contacts that is the one thing it must never do. So the
 * default is `private, no-store`, and a route that is the same for every
 * caller says so itself with `@Header("Cache-Control", PUBLIC_LIST)` or
 * `res.setHeader`, which replace this value. Error responses skip `@Header`,
 * so a 404 or a 429 keeps the default.
 *
 * Swagger UI (`/api/docs`) is left alone: its JS and CSS are static.
 */
export const NO_STORE = "private, no-store";

/**
 * A public list that changes when an admin approves something: a minute in
 * the browser, five at the edge, and up to ten more served stale while the
 * edge refreshes it.
 */
export const PUBLIC_LIST = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

export function defaultNoStore(req: Request, res: Response, next: NextFunction) {
  if (!req.url.startsWith("/api/docs")) res.setHeader("Cache-Control", NO_STORE);
  next();
}
