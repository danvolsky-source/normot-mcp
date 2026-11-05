// Live smoke test: calls every tool against a running MCP endpoint, which in
// turn calls the live NORMOT API. Fails (exit 1) if any call errors or a
// result lacks the fields agents rely on (ids, urls, citation).
//
//   MCP_URL=http://localhost:8787/mcp npm run smoke     (default)
//   MCP_URL=https://mcp.normot.co.il/mcp npm run smoke

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://localhost:8787/mcp");

type Check = (data: any) => string | null;

const cases: { tool: string; args: Record<string, unknown>; check: Check; expectError?: boolean }[] = [
  {
    tool: "search_norms",
    args: { query: "מעקה", limit: 3 },
    check: (d) => (d.items?.length > 0 && d.items[0].url?.startsWith("https://normot.co.il/u/") ? null : "no items with url"),
  },
  {
    tool: "get_norm",
    args: { id: "u-rb01-preconditions" },
    check: (d) => (d.statement_he && d.cite?.text_he && d.print_check?.code ? null : "missing statement/cite/print_check"),
  },
  {
    tool: "get_norm",
    args: { id: "u-does-not-exist" },
    check: (d) => (String(d.error).includes("not found") ? null : "expected not found"),
    expectError: true,
  },
  {
    tool: "list_profile_options",
    args: { which: ["uses", "stages"] },
    check: (d) => (d.uses?.length > 5 && d.stages?.length > 3 && !d.cities ? null : "bad options"),
  },
  {
    tool: "project_overview",
    args: { use: "residential", city: "tel-aviv", stage: "permit" },
    check: (d) => (d.counts?.total > 0 && Array.isArray(d.next_actions) ? null : "no counts/actions"),
  },
  {
    tool: "project_overview",
    args: { use: "residential", city: "atlantis" },
    check: (d) => (String(d.error).includes("unknown city") && d.details?.available?.length > 0 ? null : "expected unknown city"),
    expectError: true,
  },
  {
    tool: "project_overview",
    args: { use: "spaceport" },
    check: (d) => (d.details?.available?.length > 0 ? null : "expected list of valid uses"),
    expectError: true,
  },
  {
    tool: "project_requirements",
    args: { use: "food-service", city: "tel-aviv", stage: "permit", area: "fire" },
    check: (d) => (d.total > 0 && d.items?.length > 0 && d.items[0].url ? null : "no requirements"),
  },
  {
    tool: "check_norm_for_project",
    args: { use: "residential", stage: "permit", id: "u-rb01-preconditions" },
    check: (d) => (typeof d.applicable === "boolean" ? null : "no applicable flag"),
  },
  {
    tool: "permit_stages",
    args: {},
    check: (d) => (d.phases?.length > 5 && d.print_check?.length > 0 ? null : "no phases"),
  },
  {
    tool: "permit_stages",
    args: { phase: "submission" },
    check: (d) => (d.steps?.length > 0 && d.steps[0].norms?.length > 0 ? null : "no steps"),
  },
  {
    tool: "source_changes",
    args: {},
    check: (d) => (d.counts ? null : "no counts"),
  },
];

const client = new Client({ name: "normot-mcp-smoke", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(url));

const tools = await client.listTools();
const names = new Set(tools.tools.map((t) => t.name));
let failures = 0;
for (const name of new Set(cases.map((c) => c.tool))) {
  if (!names.has(name)) {
    console.error(`FAIL  tool ${name} is not listed`);
    failures++;
  }
}

for (const c of cases) {
  const started = Date.now();
  const res = await client.callTool({ name: c.tool, arguments: c.args });
  const text = (res.content as any[])?.[0]?.text ?? "";
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text };
  }
  const size = text.length;
  let problem: string | null = null;
  if (Boolean(res.isError) !== Boolean(c.expectError)) problem = `isError=${res.isError}: ${text.slice(0, 300)}`;
  else problem = c.check(data);
  if (!problem && !c.expectError && size > 60000) problem = `result too large: ${size} chars`;
  const label = `${c.tool} ${JSON.stringify(c.args)}`;
  if (problem) {
    failures++;
    console.error(`FAIL  ${label}: ${problem}`);
  } else {
    console.log(`ok    ${label}  (${Date.now() - started} ms, ${size} chars)`);
  }
}

await client.close();
console.log(failures ? `\n${failures} failed` : `\nall ${cases.length} calls passed`);
process.exit(failures ? 1 : 0);
