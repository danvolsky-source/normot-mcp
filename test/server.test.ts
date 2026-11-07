// Offline tests: the NORMOT API is replaced by fixtures, so these run in CI
// without network. The live check is scripts/smoke.ts.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clearProfileOptionsCache } from "../src/api.js";
import { handleMcp } from "../src/handler.js";
import { clip, shapeUnit } from "../src/shape.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

const realFetch = globalThis.fetch;
const requested: string[] = [];

before(() => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requested.push(url.pathname + url.search);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/units/u-ac8-t1-lift-other") return reply(200, fixture("unit.json"));
    if (url.pathname.startsWith("/api/units/")) return reply(404, { error: "unit not found" });
    if (url.pathname === "/api/search") return reply(200, fixture("search.json"));
    if (url.pathname === "/api/page/profile") return reply(200, fixture("profile.json"));
    if (url.pathname === "/api/applicable" && url.searchParams.get("use") === "spaceport")
      return reply(400, { error: "unknown use", available: [{ code: "residential", title_he: "מגורים" }] });
    return reply(500, { error: "unexpected request in test: " + url.pathname });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  requested.length = 0;
  clearProfileOptionsCache();
});

let nextId = 1;
async function rpc(method: string, params?: unknown) {
  const res = await handleMcp(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    }),
  );
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}

async function callTool(name: string, args: Record<string, unknown>) {
  const { body } = await rpc("tools/call", { name, arguments: args });
  const result = body.result;
  return { isError: Boolean(result?.isError), data: JSON.parse(result.content[0].text), raw: body };
}

describe("HTTP handling", () => {
  it("answers CORS preflight", async () => {
    const res = await handleMcp(new Request("http://localhost/mcp", { method: "OPTIONS" }));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });

  it("refuses GET (stateless server, no SSE stream)", async () => {
    const res = await handleMcp(new Request("http://localhost/mcp", { method: "GET" }));
    assert.equal(res.status, 405);
  });

  it("rejects invalid JSON", async () => {
    const res = await handleMcp(
      new Request("http://localhost/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
    );
    assert.equal(res.status, 400);
  });

  it("rejects oversized bodies", async () => {
    const res = await handleMcp(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pad: "x".repeat(70_000) }),
      }),
    );
    assert.equal(res.status, 413);
  });

  it("initializes and lists the tools, all read-only", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    assert.equal(init.status, 200);
    assert.equal(init.body.result.serverInfo.name, "normot");
    assert.match(init.body.result.instructions, /not an official publication/);

    const { body } = await rpc("tools/list");
    const names = body.result.tools.map((t: any) => t.name).sort();
    assert.deepEqual(names, [
      "check_norm_for_project",
      "get_norm",
      "list_profile_options",
      "permit_stages",
      "project_overview",
      "project_requirements",
      "search_norms",
      "source_changes",
    ]);
    for (const t of body.result.tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });
});

describe("tools", () => {
  it("get_norm returns text, print check and citation", async () => {
    const { isError, data } = await callTool("get_norm", { id: "u-ac8-t1-lift-other" });
    assert.equal(isError, false);
    assert.equal(data.url, "https://normot.co.il/u/u-ac8-t1-lift-other");
    assert.ok(data.statement_he.length > 20);
    assert.equal(data.print_check.code, "official_words");
    assert.match(data.cite.text_he, /normot\.co\.il\/u\/u-ac8-t1-lift-other/);
    assert.match(data._about, /not an official publication/);
    assert.equal(data.params[0].vhtml, undefined, "HTML display fields are dropped");
  });

  it("get_norm passes the API's not-found as a tool error", async () => {
    const { isError, data } = await callTool("get_norm", { id: "u-missing" });
    assert.equal(isError, true);
    assert.match(data.error, /not found/);
  });

  it("get_norm rejects ids that are not norm ids before calling the API", async () => {
    const { raw } = await callTool("get_norm", { id: "../../etc" }).catch(() => ({ raw: null }) as any);
    assert.equal(requested.length, 0);
    assert.ok(raw === null || raw.result?.isError || raw.error);
  });

  it("search_norms caps limit at 20", async () => {
    const { raw } = await callTool("search_norms", { query: "מעקה", limit: 500 }).catch(() => ({ raw: null }) as any);
    assert.equal(requested.length, 0);
    assert.ok(raw === null || raw.result?.isError || raw.error);
  });

  it("search_norms returns permanent urls", async () => {
    const { data } = await callTool("search_norms", { query: "מעקה", limit: 3 });
    assert.ok(data.items.length > 0);
    for (const it of data.items) assert.match(it.url, /^https:\/\/normot\.co\.il\/u\/u-/);
    assert.ok(requested[0]!.includes("limit=3"));
  });

  it("an unknown city is refused with the valid list (the API would silently ignore it)", async () => {
    const { isError, data } = await callTool("project_overview", { use: "residential", city: "atlantis" });
    assert.equal(isError, true);
    assert.match(data.error, /unknown city/);
    assert.ok(data.details.available.some((c: any) => c.code === "tel-aviv"));
    assert.ok(!requested.some((r) => r.startsWith("/api/applicable")));
  });

  it("an unknown use returns the API's list of valid codes", async () => {
    const { isError, data } = await callTool("project_overview", { use: "spaceport" });
    assert.equal(isError, true);
    assert.equal(data.details.available[0].code, "residential");
  });
});

describe("shaping", () => {
  it("clip keeps short text and marks cut text", () => {
    assert.equal(clip("abc", 5), "abc");
    assert.equal(clip("abcdefgh", 3), "abc …");
    assert.equal(clip(null, 3), null);
  });

  it("shapeUnit replaces oversized tables with a pointer", () => {
    const u = { ...fixture("unit.json"), tables: [{ rows: "x".repeat(20_000) }] };
    const shaped: any = shapeUnit(u);
    assert.equal(shaped.tables.count, 1);
    assert.match(shaped.tables.note, /normot\.co\.il/);
  });
});

describe("usage statistics", () => {
  it("records method, tool, client and only the search_norms query", async () => {
    const { collectEvents } = await import("../src/stats.js");
    const events = collectEvents([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai", version: "1" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_norms", arguments: { query: "מעקה" } } },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_norm", arguments: { id: "secret-ish" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    assert.deepEqual(events, [
      { method: "initialize", client: "claude-ai" },
      { method: "tools/call", tool: "search_norms", q: "מעקה" },
      { method: "tools/call", tool: "get_norm" },
      { method: "notifications/initialized" },
    ]);
  });

  it("sends one RPC per request when configured, and nothing otherwise", async () => {
    const { sendStats } = await import("../src/stats.js");
    const saved = globalThis.fetch;
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response("", { status: 204 });
    }) as typeof fetch;
    try {
      await sendStats([{ method: "tools/list" }], "ua");
      assert.equal(calls.length, 0);
      process.env.NORMOT_STATS_URL = "https://db.example/";
      process.env.NORMOT_STATS_ANON_KEY = "anon";
      process.env.NORMOT_STATS_INGEST_KEY = "ingest";
      await sendStats([{ method: "tools/list" }], "ua");
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://db.example/rest/v1/rpc/core_mcp_hit");
      assert.deepEqual(calls[0]!.body, { p_key: "ingest", p_ua: "ua", p_events: [{ method: "tools/list" }] });
    } finally {
      delete process.env.NORMOT_STATS_URL;
      delete process.env.NORMOT_STATS_ANON_KEY;
      delete process.env.NORMOT_STATS_INGEST_KEY;
      globalThis.fetch = saved;
    }
  });
});
