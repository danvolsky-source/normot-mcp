-- MCP usage statistics in the NORMOT database (Supabase project Tokef).
-- Applied as migration "mcp_stats". Same shape as the site's core.page_hits /
-- core.search_hits: daily counters, no per-request rows, no IPs.
--
-- Writer: public.core_mcp_hit, called by the MCP server with the publishable
-- (anon) key plus an ingest key whose sha256 sits in core.report_keys
-- under name 'mcp-ingest'. Without that key the call does nothing.
-- Bots are not filtered on write; core.mcp_bot_patterns marks them on read,
-- so the list can grow without touching the server.

create table if not exists core.mcp_hits (
  day    date    not null,
  method text    not null,
  tool   text    not null default '',
  client text    not null default '',
  ua     text    not null default '',
  n      integer not null default 0,
  primary key (day, method, tool, client, ua)
);

create table if not exists core.mcp_search_hits (
  day date    not null,
  q   text    not null,
  n   integer not null default 0,
  primary key (day, q)
);

create table if not exists core.mcp_bot_patterns (
  pattern text primary key,          -- matched with ILIKE '%pattern%' against client and ua
  note    text
);

alter table core.mcp_hits         enable row level security;
alter table core.mcp_search_hits  enable row level security;
alter table core.mcp_bot_patterns enable row level security;

insert into core.mcp_bot_patterns (pattern, note) values
  ('probe',              'generic: *-probe, *Probe clients and UAs'),
  ('mcpbeat',            'liveness checker'),
  ('glama',              'Glama catalog'),
  ('mcpwell',            'catalog badge checker'),
  ('OpenTask-Directory', 'catalog'),
  ('normot-mcp-smoke',   'our own smoke test'),
  ('bot',                'generic')
on conflict (pattern) do nothing;

create or replace function public.core_mcp_hit(p_key text, p_ua text default null, p_events jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'core'
as $function$
declare
  v_ua  text := left(coalesce(p_ua, ''), 120);
  v_ev  jsonb;
  v_q   text;
begin
  if not exists (select 1 from core.report_keys k
                  where k.name = 'mcp-ingest'
                    and k.key_sha256 = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')) then
    return;
  end if;
  if jsonb_typeof(p_events) <> 'array' then
    return;
  end if;

  for v_ev in select e from jsonb_array_elements(p_events) e limit 20 loop
    continue when jsonb_typeof(v_ev) <> 'object' or coalesce(v_ev->>'method', '') = '';
    insert into core.mcp_hits (day, method, tool, client, ua, n)
         values (current_date,
                 left(v_ev->>'method', 60),
                 left(coalesce(v_ev->>'tool', ''), 60),
                 left(coalesce(v_ev->>'client', ''), 80),
                 v_ua, 1)
    on conflict (day, method, tool, client, ua) do update set n = core.mcp_hits.n + 1;

    v_q := nullif(btrim(left(coalesce(v_ev->>'q', ''), 200)), '');
    if v_q is not null then
      insert into core.mcp_search_hits (day, q, n) values (current_date, v_q, 1)
      on conflict (day, q) do update set n = core.mcp_search_hits.n + 1;
    end if;
  end loop;
end
$function$;

revoke all on function public.core_mcp_hit(text, text, jsonb) from public;
grant execute on function public.core_mcp_hit(text, text, jsonb) to anon, service_role;

-- Read side: every counter row with a bot flag.
create or replace view core.v_mcp_hits as
select h.*,
       exists (select 1 from core.mcp_bot_patterns b
                where h.client ilike '%' || b.pattern || '%'
                   or h.ua     ilike '%' || b.pattern || '%') as is_bot
  from core.mcp_hits h;

-- Example: tool calls per day from non-bots
--   select day, tool, sum(n) from core.v_mcp_hits
--    where method = 'tools/call' and not is_bot group by 1, 2 order by 1 desc, 3 desc;
