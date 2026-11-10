// Usage statistics: daily counters in the NORMOT database.
// One RPC per HTTP request (a JSON-RPC batch becomes one call), sent after the
// response so a slow or unavailable database never delays an answer.
// Off unless all three env vars are set (tests and local runs stay offline).

export interface StatEvent {
  method: string;
  tool?: string;
  client?: string;
  /** search_norms query text only; other tool arguments are never recorded. */
  q?: string;
}

const TIMEOUT_MS = 3000;

function config() {
  const url = process.env.NORMOT_STATS_URL?.replace(/\/+$/, "");
  const anonKey = process.env.NORMOT_STATS_ANON_KEY;
  const ingestKey = process.env.NORMOT_STATS_INGEST_KEY;
  return url && anonKey && ingestKey ? { url, anonKey, ingestKey } : null;
}

/** Builds the events for one request. `messages` is the parsed JSON-RPC body. */
export function collectEvents(messages: unknown): StatEvent[] {
  const list = Array.isArray(messages) ? messages : [messages];
  const out: StatEvent[] = [];
  for (const m of list) {
    if (!m || typeof m !== "object" || !("method" in m)) continue;
    const msg = m as { method: unknown; params?: any };
    if (typeof msg.method !== "string") continue;
    const ev: StatEvent = { method: msg.method.slice(0, 60) };
    if (msg.method === "tools/call" && typeof msg.params?.name === "string") {
      ev.tool = msg.params.name.slice(0, 60);
      const q = msg.params?.arguments?.query;
      if (ev.tool === "search_norms" && typeof q === "string") ev.q = q.slice(0, 200);
    }
    if (msg.method === "initialize" && typeof msg.params?.clientInfo?.name === "string") {
      ev.client = msg.params.clientInfo.name.slice(0, 80);
    }
    out.push(ev);
  }
  return out;
}

/** Sends one request's events. Never throws; failures are logged and dropped. */
export async function sendStats(events: StatEvent[], userAgent: string | null): Promise<void> {
  const cfg = config();
  if (!cfg || events.length === 0) return;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/core_mcp_hit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: cfg.anonKey,
        authorization: `Bearer ${cfg.anonKey}`,
      },
      body: JSON.stringify({ p_key: cfg.ingestKey, p_ua: (userAgent ?? "").slice(0, 120), p_events: events }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(JSON.stringify({ evt: "mcp_stats_error", status: res.status }));
  } catch (err) {
    console.error(JSON.stringify({ evt: "mcp_stats_error", message: (err as Error).message }));
  }
}
