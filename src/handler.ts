// Web-standard request handler (Request -> Response) for the MCP endpoint.
// Stateless: every request gets a fresh server and transport, so it runs on
// serverless functions without sessions, Redis or sticky routing.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { collectEvents, sendStats } from "./stats.js";

/** Runs work after the response is sent (Vercel's waitUntil). Without it, the work is awaited. */
export type Defer = (work: Promise<unknown>) => void;

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function json(status: number, body: unknown): Response {
  return withCors(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } }),
  );
}

/** One log line per JSON-RPC call: method, tool name, client. Never the arguments (user queries). */
function logCalls(messages: unknown, userAgent: string | null, ms: number, status: number): void {
  const list = Array.isArray(messages) ? messages : [messages];
  for (const m of list) {
    if (!m || typeof m !== "object" || !("method" in m)) continue;
    const msg = m as { method: string; params?: any };
    const entry: Record<string, unknown> = { evt: "mcp", method: msg.method, status, ms };
    if (msg.method === "tools/call") entry.tool = msg.params?.name;
    if (msg.method === "initialize") {
      entry.client = msg.params?.clientInfo?.name;
      entry.client_version = msg.params?.clientInfo?.version;
      entry.protocol = msg.params?.protocolVersion;
    }
    if (userAgent) entry.ua = userAgent.slice(0, 120);
    console.log(JSON.stringify(entry));
  }
}

export const INFO = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  description: "MCP server for NORMOT, a database of Israeli building norms (https://normot.co.il).",
  transport: "streamable-http",
  endpoint: "/mcp",
  docs: "https://github.com/danvolsky-source/normot-mcp",
  api: "https://normot.co.il/api",
  terms: "https://normot.co.il/terms",
};

export async function handleMcp(req: Request, defer?: Defer): Promise<Response> {
  if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

  if (req.method !== "POST") {
    // Stateless server: no SSE stream to open (GET) and no session to end (DELETE).
    return json(405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Send JSON-RPC requests with POST." },
      id: null,
    });
  }

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) {
    return json(413, { jsonrpc: "2.0", error: { code: -32600, message: "Request body too large" }, id: null });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json(413, { jsonrpc: "2.0", error: { code: -32600, message: "Request body too large" }, id: null });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
  }

  const started = Date.now();
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const res = await transport.handleRequest(req, { parsedBody: parsed });
    logCalls(parsed, req.headers.get("user-agent"), Date.now() - started, res.status);
    const stats = sendStats(collectEvents(parsed), req.headers.get("user-agent"));
    if (defer) defer(stats);
    else await stats;
    return withCors(res);
  } catch (err) {
    console.error(JSON.stringify({ evt: "mcp_error", message: (err as Error).message }));
    return json(500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  } finally {
    // With enableJsonResponse the body is fully built before handleRequest resolves.
    void transport.close();
    void server.close();
  }
}
