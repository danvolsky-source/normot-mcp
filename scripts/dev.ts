// Local server for development: http://localhost:8787/mcp
import { serve } from "@hono/node-server";
import { handleMcp, INFO } from "../src/handler.js";

const port = Number(process.env.PORT ?? 8787);

serve({
  port,
  fetch: (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/mcp" || pathname === "/api/mcp") return handleMcp(req);
    if (pathname === "/") return Response.json(INFO);
    return new Response("Not found", { status: 404 });
  },
});
console.log(`normot-mcp listening on http://localhost:${port}/mcp`);
