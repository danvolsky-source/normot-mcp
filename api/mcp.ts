// Vercel Function: the MCP endpoint, served at /mcp (see vercel.json).
import { handleMcp } from "../src/handler.js";

export const maxDuration = 30;

export function POST(request: Request): Promise<Response> {
  return handleMcp(request);
}
export function GET(request: Request): Promise<Response> {
  return handleMcp(request);
}
export function DELETE(request: Request): Promise<Response> {
  return handleMcp(request);
}
export function OPTIONS(request: Request): Promise<Response> {
  return handleMcp(request);
}
