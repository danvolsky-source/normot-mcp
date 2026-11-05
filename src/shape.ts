// Shaping of API payloads into compact tool results.
// Rules: every norm keeps its permanent URL; long texts are clipped in lists
// (the full text is one get_norm call away); display-only fields (HTML) are dropped.

import { SITE } from "./api.js";

export const ABOUT =
  "Source: NORMOT (normot.co.il), a database of Israeli building norms. NORMOT is not an official publication; " +
  "the binding text is the official publication (Reshumot / the issuing authority). " +
  "When you rely on a norm, cite it with its permanent URL (field url) or the ready citation line (cite).";

export function clip(text: unknown, max: number): string | null {
  if (text === null || text === undefined) return null;
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max).trimEnd() + " …";
}

export function normUrl(id: string): string {
  return `${SITE}/u/${id}`;
}

export function idFromNormUrl(url: string): string {
  const m = /\/u\/([^/?#]+)/.exec(url);
  return m?.[1] ?? url;
}

function dropEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

function shapeParams(params: any[] | null | undefined) {
  if (!Array.isArray(params) || params.length === 0) return undefined;
  return params.map((p) =>
    dropEmpty({ name: p.name, op: p.op, value: p.value, unit: p.unit, text: p.vtext, condition: p.condition }),
  );
}

// ---- search -----------------------------------------------------------------

export function shapeSearch(body: any, statementMax = 700) {
  return {
    total: body.total,
    offset: body.offset,
    returned: Array.isArray(body.items) ? body.items.length : 0,
    items: (body.items ?? []).map((it: any) =>
      dropEmpty({
        id: it.id,
        url: normUrl(it.id),
        document: it.document,
        section: it.section,
        statement_he: clip(it.statement_he, statementMax),
        authority: it.authority,
        in_force: it.in_force,
        in_force_he: it.in_force_he,
      }),
    ),
  };
}

// ---- one norm -----------------------------------------------------------------

const MAX_TABLES_JSON = 12000;

export function shapeUnit(u: any) {
  const doc = u.document ?? {};
  const ev = u.evidence ?? {};
  let tables: unknown = undefined;
  if (Array.isArray(u.tables) && u.tables.length > 0) {
    const json = JSON.stringify(u.tables);
    tables =
      json.length <= MAX_TABLES_JSON
        ? u.tables
        : {
            count: u.tables.length,
            note: `Tables are too large to include here; see ${normUrl(u.id)} or ${SITE}/api/units/${u.id}`,
          };
  }
  return dropEmpty({
    id: u.id,
    url: normUrl(u.id),
    statement_he: u.statement_he,
    applicability_he: u.applicability,
    kind: u.kind,
    authority: u.authority,
    scope: u.scope,
    section: u.section,
    document: dropEmpty({
      id: doc.id,
      title: doc.title,
      registry: doc.registry,
      kind: doc.source_kind,
      in_force: doc.in_force,
      effective_from: doc.effective_from,
      source_url: doc.source_url,
    }),
    effective_from: u.effective_from,
    effective_to: u.effective_to,
    time_notes: u.time_notes,
    params: shapeParams(u.params),
    standards: u.standards,
    exceptions: u.exceptions,
    overridden_by: u.overridden_by,
    links: u.links,
    disputes: u.disputes,
    tables,
    print_check: u.print_check
      ? dropEmpty({
          code: u.print_check.code,
          checked_against_print: u.print_check.against_print,
          label_he: u.print_check.label_he,
        })
      : undefined,
    published_in: ev.published_in,
    text_source: ev.text_source
      ? dropEmpty({ label_he: ev.text_source.label_he, url: ev.text_source.url, retrieved_at: ev.text_source.retrieved_at })
      : undefined,
    cite: u.cite ? dropEmpty({ text_he: u.cite.text_he, url: u.cite.url, rule_he: u.cite.rule_he }) : undefined,
  });
}

// ---- project profile views -----------------------------------------------------

export function shapePassport(p: any) {
  return dropEmpty({
    profile_he: p.profile_he,
    stage_assumed: p.stage_assumed,
    counts: p.counts,
    counts_note:
      "applies = applies to this profile; data = depends on project data not given yet; review = needs a specialist's review",
    gaps: p.gaps,
    next_actions: (p.actions ?? []).map((a: any) =>
      dropEmpty({
        rank: a.rank,
        title_he: a.title_he,
        status: a.status,
        actor_he: a.actor_he,
        trigger_he: a.trigger_he,
        output_he: a.output_he,
        question_he: a.question_he,
        source: a.source
          ? dropEmpty({
              id: a.source.id,
              url: a.source.url ?? (a.source.id ? normUrl(a.source.id) : undefined),
              section: a.source.section,
              document: a.source.doc_title,
            })
          : undefined,
      }),
    ),
    stage_steps: p.stage_steps,
    questions_to_narrow: p.questions,
    corpus: p.corpus,
    note_he: p.note_he,
  });
}

export function shapeRequirements(r: any, statementMax = 350) {
  return dropEmpty({
    total: r.total,
    offset: r.offset,
    returned: Array.isArray(r.items) ? r.items.length : 0,
    page_size: 50,
    counts: r.counts,
    by_area: r.by_area,
    items: (r.items ?? []).map((it: any) =>
      dropEmpty({
        id: it.id,
        url: normUrl(it.id),
        state: it.k,
        area: it.area_title,
        document: it.doc_title,
        section: clip(it.section, 200),
        applies_to_he: clip(it.title_he, 250),
        statement_he: clip(it.statement_he, statementMax),
      }),
    ),
  });
}

// ---- permit stages (Rishuy Zamin) ----------------------------------------------

export function shapeRishuyOverview(body: any) {
  const d = body.data ?? body;
  return dropEmpty({
    about_he: d.about_he,
    phases: (d.phases ?? []).map((p: any) =>
      dropEmpty({
        code: p.code,
        title_he: p.title_he,
        in_system: p.in_system,
        steps: (p.steps ?? []).map((s: any) => `${s.title_he} (${(s.norms ?? []).length} norms)`),
      }),
    ),
    print_check: (d.print_check ?? []).map((c: any) =>
      dropEmpty({ code: c.code, against_print: c.against_print, label: c.label_en, units: c.units }),
    ),
    measured_error_rates: (d.accuracy_audits ?? []).map((a: any) =>
      dropEmpty({
        measured_on: a.measured_on,
        layer_he: a.layer_he,
        sample: a.sample,
        rate: a.rate,
        ci: [a.ci_low, a.ci_high],
      }),
    ),
    how_to_cite: d.cite,
    hint: "Call permit_stages with a phase code to get its steps and the norms behind each step.",
  });
}

export function shapeRishuyPhase(body: any, phase: string, maxNormsPerStep = 30) {
  const d = body.data ?? body;
  const p = (d.phases ?? []).find((x: any) => x.code === phase);
  if (!p) return null;
  return dropEmpty({
    code: p.code,
    title_he: p.title_he,
    in_system: p.in_system,
    basis_he: p.basis_he,
    source_url: p.source_url,
    steps: (p.steps ?? []).map((s: any) => {
      const norms: string[] = s.norms ?? [];
      return dropEmpty({
        code: s.code,
        title_he: s.title_he,
        actor_he: s.actor_he,
        kind: s.kind,
        norms_total: norms.length,
        norms: norms.slice(0, maxNormsPerStep).map((u) => ({ id: idFromNormUrl(u), url: u })),
      });
    }),
    hint: "Call get_norm with a norm id for its text and citation.",
  });
}

export function phaseCodes(body: any): string[] {
  const d = body.data ?? body;
  return (d.phases ?? []).map((p: any) => String(p.code));
}

// ---- source changes ----------------------------------------------------------

export function shapeSourceChanges(body: any) {
  return dropEmpty({
    note_he: body.note_he,
    counts: body.counts,
    items: body.items,
    reshumot_latest: body.reshumot,
  });
}
