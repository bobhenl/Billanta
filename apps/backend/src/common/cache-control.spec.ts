import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { defaultNoStore, NO_STORE } from "./cache-control";

function run(url: string) {
  const headers = new Map<string, string>();
  const res = { setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  defaultNoStore({ url } as Request, res, next);
  return { cacheControl: headers.get("cache-control"), next };
}

describe("defaultNoStore", () => {
  it("marks API responses private, no-store and continues", () => {
    const { cacheControl, next } = run("/api/v1/invoices?status=paid");
    expect(cacheControl).toBe(NO_STORE);
    expect(next).toHaveBeenCalledOnce();
  });

  it("leaves Swagger UI's static files to their own headers", () => {
    const { cacheControl, next } = run("/api/docs/swagger-ui.css");
    expect(cacheControl).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
