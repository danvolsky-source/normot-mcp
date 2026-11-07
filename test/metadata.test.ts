// Registry and catalog metadata: every tool argument is described, and
// server.json agrees with what the server itself reports. Offline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleMcp } from "../src/handler.js";
import { ICONS, SERVER_VERSION } from "../src/server.js";

const serverJson = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

async function rpc(method: string, params?: unknown) {
  const res = await handleMcp(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  return (await res.json()) as any;
}

describe("metadata", () => {
  it("describes every argument of every tool", async () => {
    const { result } = await rpc("tools/list");
    const missing: string[] = [];
    for (const tool of result.tools) {
      for (const [arg, schema] of Object.entries<any>(tool.inputSchema.properties ?? {})) {
        if (!schema.description?.trim()) missing.push(`${tool.name}.${arg}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("keeps versions and icons in step with server.json", async () => {
    assert.equal(serverJson.version, SERVER_VERSION);
    assert.equal(packageJson.version, SERVER_VERSION);
    assert.deepEqual(serverJson.icons, ICONS);
    for (const icon of ICONS) assert.match(icon.src, /^https:\/\//);
    const { result } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    assert.equal(result.serverInfo.version, SERVER_VERSION);
    assert.deepEqual(result.serverInfo.icons, ICONS);
  });
});
