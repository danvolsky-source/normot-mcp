// Thin client for the public NORMOT read API (https://normot.co.il/api).
// The MCP server never talks to the database directly: everything goes
// through the same public, rate-limited API the site documents in llms.txt.

export const API_BASE = (process.env.NORMOT_API_BASE ?? "https://normot.co.il/api").replace(/\/+$/, "");
export const SITE = "https://normot.co.il";
const USER_AGENT = "normot-mcp/0.1 (+https://github.com/danvolsky-source/normot-mcp)";
const TIMEOUT_MS = Number(process.env.NORMOT_API_TIMEOUT_MS ?? 20000);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | undefined | null>;

export function buildUrl(path: string, query: Query = {}): string {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function getJson<T = any>(path: string, query: Query = {}): Promise<T> {
  const url = buildUrl(path, query);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(`NORMOT API unreachable: ${(err as Error).message}`, 0, null);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 500);
  }
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body ? String((body as any).error) : `HTTP ${res.status}`;
    throw new ApiError(`NORMOT API: ${msg}`, res.status, body);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Profile options (uses, stages, cities, ...). The API silently ignores an
// unknown city or role, so the server validates those itself against this list.

export interface Option {
  code: string;
  title_he: string;
}
export interface ProfileOptions {
  uses: Option[];
  stages: Option[];
  cities: Option[];
  sites: Option[];
  features: Option[];
  roles: Option[];
  areas: Option[];
}

const OPTIONS_TTL_MS = 60 * 60 * 1000;
let optionsCache: { at: number; value: ProfileOptions } | null = null;

export async function getProfileOptions(): Promise<ProfileOptions> {
  if (optionsCache && Date.now() - optionsCache.at < OPTIONS_TTL_MS) return optionsCache.value;
  const page = await getJson<{ data: Record<string, any[]> }>("/page/profile");
  const d = page.data ?? {};
  const opt = (list: any[] | undefined, codeKey = "code", titleKey = "title_he"): Option[] =>
    (list ?? []).map((x) => ({ code: String(x[codeKey]), title_he: String(x[titleKey] ?? "") }));
  const value: ProfileOptions = {
    uses: opt(d.uses),
    stages: opt(d.stages),
    cities: opt(d.cities, "slug", "name_he"),
    sites: opt(d.sites),
    features: opt(d.features),
    roles: opt(d.roles),
    areas: opt(d.areas),
  };
  optionsCache = { at: Date.now(), value };
  return value;
}

export function clearProfileOptionsCache(): void {
  optionsCache = null;
}
