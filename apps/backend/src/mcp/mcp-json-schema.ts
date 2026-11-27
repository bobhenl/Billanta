import { zodToOpenAPI } from "nestjs-zod";
import type { ZodTypeAny } from "zod";

type Json = Record<string, unknown>;

/**
 * A tool's `inputSchema` from the same zod schema that validates the call.
 * nestjs-zod emits OpenAPI 3.0, which differs from the JSON Schema MCP
 * clients expect in one way that matters: `nullable: true` instead of a
 * `"null"` type. Transforms and coerced dates come out as `{}` (any value);
 * the tool descriptions say what those fields take.
 */
export function toInputSchema(schema: ZodTypeAny): Json {
  const out = normalise(zodToOpenAPI(schema) as Json);
  return { type: "object", ...out };
}

function normalise(node: Json): Json {
  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "nullable") continue;
    if (key === "properties" && value && typeof value === "object") {
      out.properties = Object.fromEntries(Object.entries(value as Record<string, Json>).map(([k, v]) => [k, normalise(v)]));
    } else if ((key === "items" || key === "additionalProperties") && value && typeof value === "object") {
      out[key] = normalise(value as Json);
    } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      out[key] = (value as Json[]).map(normalise);
    } else {
      out[key] = value;
    }
  }
  if (node.nullable === true) {
    if (typeof out.type === "string") out.type = [out.type, "null"];
    if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
  }
  return out;
}
