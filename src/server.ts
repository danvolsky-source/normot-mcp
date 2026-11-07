import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod";
import { ApiError, getJson, getProfileOptions, type Query } from "./api.js";
import {
  ABOUT,
  phaseCodes,
  shapePassport,
  shapeRequirements,
  shapeRishuyOverview,
  shapeRishuyPhase,
  shapeSearch,
  shapeSourceChanges,
  shapeUnit,
} from "./shape.js";

export const SERVER_NAME = "normot";
export const SERVER_VERSION = "0.1.1";

/** Same icons as in server.json; served by the normot.co.il site. */
export const ICONS = [
  { src: "https://normot.co.il/apple-touch-icon.png", mimeType: "image/png", sizes: ["180x180"] },
  { src: "https://normot.co.il/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
];

const INSTRUCTIONS = `NORMOT (normot.co.il) is a database of Israeli building and planning norms: laws, regulations, ministry and agency guidelines, municipal spatial guidelines (הנחיות מרחביות) and references to SII standards (ת"י) — about 120,000 norms, each with a permanent URL, its source document and section, dates in force, and how its text was checked against the printed source.

Use it for questions about Israeli building permits (היתר בנייה, רישוי זמין), planning and building law (חוק התכנון והבנייה), accessibility, fire safety, protected spaces (ממ"ד), parking, business licensing (רישוי עסקים) and municipal requirements.

Typical flow: search_norms or get_norm for a specific rule; list_profile_options, then project_overview and project_requirements for "what applies to my project"; permit_stages for the Rishuy Zamin permit process.

Norm texts are in Hebrew, as in the source; search in Hebrew. NORMOT is not an official publication: always give the norm's URL or its cite line, and say that the binding text is the official publication. Answers are a preliminary check, not legal or engineering advice. Standard (SII) texts are not included.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ ...(data as object), _about: ABOUT }) }] };
}

function fail(message: string, details?: unknown): CallToolResult {
  const payload = details === undefined ? { error: message } : { error: message, details };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      // The API answers unknown codes with the list of valid ones: pass it on.
      return fail(err.message, err.body ?? undefined);
    }
    return fail(`Unexpected error: ${(err as Error).message}`);
  }
}

// ---- project profile --------------------------------------------------------

const profileShape = {
  use: z
    .string()
    .max(200)
    .optional()
    .describe("Use code, or several comma-separated for a mixed building, e.g. residential or retail,office. See list_profile_options."),
  city: z.string().max(80).optional().describe("Municipality slug, e.g. tel-aviv, jerusalem. See list_profile_options."),
  stage: z
    .enum(["feasibility", "design", "permit", "execution", "completion", "operation"])
    .optional()
    .describe(
      "Project stage: feasibility (היתכנות ותכנון ראשוני), design (תכנון מפורט), permit (רישוי ובקשה להיתר), execution (ביצוע באתר), completion (גמר וטופס 4), operation (תפעול ותחזוקה). Omit = all stages",
    ),
  status: z.enum(["new", "existing"]).optional().describe("new = new building; existing = existing building"),
  height_class: z
    .enum(["low", "high", "multistory"])
    .optional()
    .describe("Building height class: low, high or multistory. Omit if unknown (no norm is excluded)"),
  track: z
    .enum(["standard", "short", "fast"])
    .optional()
    .describe("Permit track: standard, short or fast. Omit if unknown (no norm is excluded)"),
  role: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Show the norms for one party, e.g. architect, developer, fire (fire safety consultant), authority: a role code from list_profile_options. Omit for all parties",
    ),
  site: z
    .string()
    .max(500)
    .optional()
    .describe("Comma-separated plot condition codes that apply; 'none' = checked and none apply; omit = not checked"),
  features: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "Comma-separated project element codes from list_profile_options (features), e.g. pool; 'none' = checked and none apply; omit = not checked",
    ),
  floor_area: z.number().nonnegative().optional().describe("Floor area, m²; used for area thresholds in norms"),
  building_height: z.number().nonnegative().optional().describe("Building height, m; used for height thresholds in norms"),
  storeys: z.number().int().nonnegative().optional().describe("Number of storeys; used for thresholds in norms"),
  dwelling_units: z.number().int().nonnegative().optional().describe("Number of dwelling units (apartments)"),
  occupancy: z.number().int().nonnegative().optional().describe("Number of occupants; used for occupancy thresholds in norms"),
  beds: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Number of beds, e.g. in a hotel, hospital or care home; used for thresholds in norms"),
  rooms: z.number().int().nonnegative().optional().describe("Number of rooms; used for thresholds in norms"),
};

type Profile = { [K in keyof typeof profileShape]?: z.infer<(typeof profileShape)[K]> };

const PROFILE_KEYS = Object.keys(profileShape) as (keyof Profile)[];

/** Builds the API query for a profile. The API silently ignores an unknown city or role, so check those here. */
async function profileQuery(p: Profile): Promise<{ query: Query } | { error: CallToolResult }> {
  if (p.city || p.role) {
    const opts = await getProfileOptions();
    if (p.city && !opts.cities.some((c) => c.code === p.city)) {
      return { error: fail(`unknown city: ${p.city}`, { available: opts.cities }) };
    }
    if (p.role && !opts.roles.some((r) => r.code === p.role)) {
      return { error: fail(`unknown role: ${p.role}`, { available: opts.roles }) };
    }
  }
  const query: Query = {};
  for (const key of PROFILE_KEYS) query[key] = p[key] as string | number | undefined;
  return { query };
}

function pickProfile(args: Record<string, unknown>): Profile {
  const p: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) if (args[key] !== undefined) p[key] = args[key];
  return p as Profile;
}

// ---- server ----------------------------------------------------------------------

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: "NORMOT — Israeli building norms",
      websiteUrl: "https://normot.co.il",
      icons: ICONS,
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "search_norms",
    {
      title: "Search norms",
      description:
        "Search Israeli building and planning norms by Hebrew words (substring search over norm texts, sections and document titles; norms in force come first). Returns norms with their permanent URL; call get_norm for the full text and citation.",
      inputSchema: {
        query: z.string().min(2).max(200).describe("Hebrew search words, e.g. מעקה, ממ\"ד, רוחב מדרגות"),
        limit: z.number().int().min(1).max(20).default(10).describe("How many norms to return, 1–20"),
        offset: z.number().int().min(0).max(100).default(0).describe("For the next page; at most 100 (no bulk export)"),
      },
      annotations: { title: "Search norms", ...READ_ONLY },
    },
    async ({ query, limit, offset }) =>
      guarded(async () => ok(shapeSearch(await getJson("/search", { q: query, limit, offset })))),
  );

  server.registerTool(
    "get_norm",
    {
      title: "Get one norm",
      description:
        "One norm by id: full Hebrew text, applicability, source document and section, dates in force, numeric values, exceptions, how its text was checked against print (print_check), and a ready citation line (cite).",
      inputSchema: {
        id: z
          .string()
          .regex(/^u-[A-Za-z0-9._-]+$/, "a norm id looks like u-rb01-preconditions")
          .max(160)
          .describe("Norm id, e.g. u-rb01-preconditions (the last part of https://normot.co.il/u/{id})"),
      },
      annotations: { title: "Get one norm", ...READ_ONLY },
    },
    async ({ id }) => guarded(async () => ok(shapeUnit(await getJson(`/units/${encodeURIComponent(id)}`)))),
  );

  server.registerTool(
    "list_profile_options",
    {
      title: "List project profile options",
      description:
        "Valid codes for a project profile: uses, stages, cities (municipality slugs), plot conditions (sites), project elements (features), roles and requirement areas. Call before project_overview or project_requirements if unsure of a code.",
      inputSchema: {
        which: z
          .array(z.enum(["uses", "stages", "cities", "sites", "features", "roles", "areas"]))
          .optional()
          .describe("Only these lists; omit for all"),
      },
      annotations: { title: "List project profile options", ...READ_ONLY },
    },
    async ({ which }) =>
      guarded(async () => {
        const opts = await getProfileOptions();
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(opts)) if (!which || which.includes(k as any)) out[k] = v;
        return ok(out);
      }),
  );

  server.registerTool(
    "project_overview",
    {
      title: "Project overview (what applies)",
      description:
        "For a project profile (use, city, stage and optional details): how many norms apply, which depend on missing data or need a specialist, the next permit actions with their legal source, and which questions would narrow the list most. Every omitted detail keeps norms in (over-inclusive by design).",
      inputSchema: profileShape,
      annotations: { title: "Project overview", ...READ_ONLY },
    },
    async (args) =>
      guarded(async () => {
        const built = await profileQuery(pickProfile(args));
        if ("error" in built) return built.error;
        const body = await getJson("/applicable", { ...built.query, view: "passport", ask: 1 });
        return ok(shapePassport(body));
      }),
  );

  server.registerTool(
    "project_requirements",
    {
      title: "Project requirements",
      description:
        "The norms that apply to a project profile, 50 per page, filterable by requirement area (e.g. fire, egress, parking, accessibility), by state and by Hebrew words. Texts are clipped; call get_norm for the full text.",
      inputSchema: {
        ...profileShape,
        area: z.string().max(60).optional().describe("Requirement area code, e.g. fire, egress, protected-space, parking"),
        state: z
          .enum(["all", "applies", "data", "review"])
          .default("all")
          .describe("applies = applies; data = depends on missing project data; review = needs a specialist"),
        q: z.string().max(200).optional().describe("Hebrew words to filter by"),
        offset: z.number().int().min(0).max(5000).default(0).describe("Multiple of 50 for the next page"),
      },
      annotations: { title: "Project requirements", ...READ_ONLY },
    },
    async (args) =>
      guarded(async () => {
        const built = await profileQuery(pickProfile(args));
        if ("error" in built) return built.error;
        const body = await getJson("/applicable", {
          ...built.query,
          view: "requirements",
          k: args.state,
          area: args.area,
          q: args.q,
          offset: args.offset,
        });
        return ok(shapeRequirements(body));
      }),
  );

  server.registerTool(
    "check_norm_for_project",
    {
      title: "Why a norm applies to a project",
      description:
        "For one norm and a project profile: does it apply, why (by use, authority, stage) and which conditions could change that.",
      inputSchema: {
        ...profileShape,
        id: z
          .string()
          .regex(/^u-[A-Za-z0-9._-]+$/, "a norm id looks like u-rb01-preconditions")
          .max(160)
          .describe("Norm id from search_norms or project_requirements, e.g. u-rb01-preconditions"),
      },
      annotations: { title: "Why a norm applies", ...READ_ONLY },
    },
    async (args) =>
      guarded(async () => {
        const built = await profileQuery(pickProfile(args));
        if ("error" in built) return built.error;
        const body = await getJson("/applicable", { ...built.query, view: "requirement", unit: args.id });
        return ok({ ...body, url: `https://normot.co.il/u/${args.id}` });
      }),
  );

  server.registerTool(
    "permit_stages",
    {
      title: "Building permit stages (Rishuy Zamin)",
      description:
        "The building-permit process mapped to the stages of the Planning Administration's online system רישוי זמין, with the norms behind each step, plus how the database's texts were checked and the measured error rates. Without a phase: an overview of all phases. With a phase code: its steps and norms. The mapping is NORMOT's work, not a Planning Administration publication.",
      inputSchema: {
        phase: z.string().max(60).optional().describe("Phase code from the overview, e.g. submission, design_control"),
      },
      annotations: { title: "Building permit stages", ...READ_ONLY },
    },
    async ({ phase }) =>
      guarded(async () => {
        const body = await getJson("/rishuy");
        if (!phase) return ok(shapeRishuyOverview(body));
        const shaped = shapeRishuyPhase(body, phase);
        if (!shaped) return fail(`unknown phase: ${phase}`, { available: phaseCodes(body) });
        return ok(shaped);
      }),
  );

  server.registerTool(
    "source_changes",
    {
      title: "Recent source changes",
      description:
        "What NORMOT's monitor detected in its sources (changed documents, expiring norms, latest Reshumot issues) and what was verified. With a profile, only documents relevant to that project.",
      inputSchema: profileShape,
      annotations: { title: "Recent source changes", ...READ_ONLY },
    },
    async (args) =>
      guarded(async () => {
        const built = await profileQuery(pickProfile(args));
        if ("error" in built) return built.error;
        return ok(shapeSourceChanges(await getJson("/applicable", { ...built.query, view: "source_changes" })));
      }),
  );

  return server;
}
