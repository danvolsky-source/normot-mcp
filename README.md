# NORMOT MCP server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server for [NORMOT](https://normot.co.il), a database of Israeli building and planning norms: laws, regulations, ministry and agency guidelines, municipal spatial guidelines (הנחיות מרחביות) and references to SII standards. About 120,000 norms, each with a permanent URL, its source document and section, dates in force, and a record of how its text was checked against the printed source.

It lets AI assistants and agents (Claude, ChatGPT, Cursor and other MCP clients) look norms up directly and cite them.

**Endpoint:** `https://mcp.normot.co.il/mcp` (Streamable HTTP, no sign-in)

## Tools

All tools are read-only.

| Tool | What it does |
| --- | --- |
| `search_norms` | Search norms by Hebrew words; norms in force first |
| `get_norm` | One norm: full text, source, section, values, print check, citation line |
| `list_profile_options` | Valid codes for a project profile: uses, stages, cities, plot conditions, elements, roles, areas |
| `project_overview` | For a project profile: how many norms apply, what needs data or a specialist, next permit actions, questions that narrow the list |
| `project_requirements` | The norms that apply to a project, by area (fire, egress, parking…), 50 per page |
| `check_norm_for_project` | Why one norm applies to a project, and what could change that |
| `permit_stages` | The permit process mapped to the stages of רישוי זמין, with the norms behind each step |
| `source_changes` | What changed in the sources: changed documents, expiring norms, latest Reshumot issues |

Norm texts are in Hebrew, as in the source. NORMOT is not an official publication: the binding text is the official publication. Every result carries the norm's permanent URL and, for single norms, a ready citation line. Quoting single norms with a link is welcome; copying the database or a substantial part of it needs agreement ([terms](https://normot.co.il/terms)).

## Connect

**Claude** (claude.ai, Claude Desktop): Settings → Connectors → Add custom connector → URL `https://mcp.normot.co.il/mcp`.

**Claude Code:**

```sh
claude mcp add --transport http normot https://mcp.normot.co.il/mcp
```

**Cursor / VS Code / other clients:** add a remote (Streamable HTTP) server with the URL above. Clients that only support stdio can use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{ "mcpServers": { "normot": { "command": "npx", "args": ["-y", "mcp-remote", "https://mcp.normot.co.il/mcp"] } } }
```

## How it works

The server is a thin, stateless layer over the public [NORMOT read API](https://normot.co.il/api). It holds no data of its own and inherits the API's rate limits; it clips long texts in lists and drops display-only fields so results fit an agent's context. It does not expose the site's semantic search (`/api/hybrid`).

It logs one line per call (method, tool name, client name, timing), never the arguments.

## Develop

```sh
npm install
npm run dev        # http://localhost:8787/mcp
npm test           # offline tests on fixtures
npm run smoke      # calls every tool against a running server and the live API
npm run typecheck
```

`NORMOT_API_BASE` overrides the API address (default `https://normot.co.il/api`).

Deployment and registry publishing: [DEPLOY.md](DEPLOY.md) (in Russian).
