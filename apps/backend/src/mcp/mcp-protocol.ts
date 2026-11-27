import { HttpException, HttpStatus } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { listMcpTools, mcpRoleAllowed, mcpToolAllowed, mcpToolByName, type McpContext } from "./mcp-tools";

/**
 * The remote MCP endpoint's JSON-RPC 2.0 layer (Streamable HTTP, stateless,
 * JSON responses only). Hand-rolled on purpose: the server needs four
 * methods, and every call already runs inside the request's RLS transaction,
 * which an SDK transport would not know about.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;
export const MCP_LATEST_VERSION = MCP_PROTOCOL_VERSIONS[0];

const SERVER_INFO = { name: "billanta", title: "Billanta", version: "1.0.0" };
const INSTRUCTIONS =
  "Billanta is invoicing software for Czech and Slovak businesses. You can read company settings, contacts, invoices, expenses and bank transactions, " +
  "and, with a read+write key, create contacts, invoice drafts and expenses. Drafts wait for a person to review and issue them in the dashboard: " +
  "nothing is issued or sent from here. Bank account and e-mail settings can only be changed in the dashboard.";

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

type JsonRpcId = string | number | null;
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

export const RPC = { parseError: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;

const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const isId = (v: unknown): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

/** The version the server answers `initialize` with: the client's when supported, else the latest. */
export const negotiateVersion = (requested: unknown) =>
  MCP_PROTOCOL_VERSIONS.find((v) => v === requested) ?? MCP_LATEST_VERSION;

/** One JSON-RPC message; null for a notification (nothing to answer). */
export async function handleMessage(ctx: McpContext, msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(isId(msg?.id) ? msg.id : null, RPC.invalidRequest, "Invalid Request");
  }
  if (msg.id === undefined) return null;
  if (!isId(msg.id)) return rpcError(null, RPC.invalidRequest, "Invalid Request");
  const id = msg.id;
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: listMcpTools(ctx.user.apiKeyScopes) } };
    case "tools/call":
      return callTool(ctx, id, params);
    default:
      return rpcError(id, RPC.methodNotFound, `Method not found: ${msg.method}`);
  }
}

const toolResult = (id: JsonRpcId, value: unknown, isError = false): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  result: { content: [{ type: "text", text: JSON.stringify(value ?? null, null, 2) }], ...(isError && { isError: true }) },
});

async function callTool(ctx: McpContext, id: JsonRpcId, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const tool = typeof params.name === "string" ? mcpToolByName(params.name) : undefined;
  if (!tool) return rpcError(id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
  const rawArgs = params.arguments ?? {};

  // The key's scope first: a read-only key is refused on a write tool even if a client calls it without listing.
  if (!mcpToolAllowed(ctx.user.apiKeyScopes, tool)) {
    return toolResult(id, { error: "api_key_read_only", status: 403, message: "This API key is read-only. Create a read+write key to use this tool." }, true);
  }
  if (!mcpRoleAllowed(ctx.user, tool, rawArgs)) {
    return toolResult(id, { error: "permission_denied", status: 403 }, true);
  }

  // Each call in its own savepoint, so a call that fails halfway leaves nothing behind.
  const savepoint = `mcp_call_${Math.random().toString(36).slice(2, 10)}`;
  await ctx.db.execute(sql.raw(`SAVEPOINT ${savepoint}`));
  try {
    tool.refuse?.(rawArgs);
    const args = tool.input.parse(rawArgs);
    const value = await tool.run(ctx, args);
    await ctx.db.execute(sql.raw(`RELEASE SAVEPOINT ${savepoint}`));
    return toolResult(id, value);
  } catch (error) {
    await ctx.db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${savepoint}`));
    const mapped = toolError(error);
    if (!mapped) throw error;
    return toolResult(id, mapped, true);
  }
}

/** The backend's own error code, as the REST API would answer it. Null for an unexpected error. */
export function toolError(error: unknown): Record<string, unknown> | null {
  if (error instanceof ZodError) {
    return {
      error: "validation_failed",
      status: 400,
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  }
  if (!(error instanceof HttpException)) return null;
  const status = error.getStatus();
  const body = error.getResponse();
  const code = /^[a-z][a-z0-9_]*$/;
  if (typeof body === "string") return code.test(body) ? { error: body, status } : { error: statusCode(status), status, message: body };
  const { statusCode: _s, error: err, message, ...rest } = body as Record<string, unknown>;
  if (typeof err === "string" && code.test(err)) return { error: err, status, ...(message !== undefined && { message }), ...rest };
  if (typeof message === "string" && code.test(message)) return { error: message, status, ...rest };
  return { error: statusCode(status), status, ...(message !== undefined && { message }), ...rest };
}

const statusCode = (status: number) => (HttpStatus[status] ?? "error").toLowerCase();
