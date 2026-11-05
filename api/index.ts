// Vercel Function: a short description of the server at / (see vercel.json).
import { INFO } from "../src/handler.js";

export function GET(): Response {
  return new Response(JSON.stringify(INFO, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
}
