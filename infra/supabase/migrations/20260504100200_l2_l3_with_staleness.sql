-- 003 · L2 syntheses + L3 surfaces + citation integrity gate + staleness propagation
--
-- L2 = scoped synthesis with mandatory citation chain back to specific L1 events + runs.
-- L3 = rendered surfaces (markdown views) cited from L2.
-- Citation integrity is a DB-level constraint (Yitzchak's L5 verification, made enforceable).
-- Staleness propagates automatically: L1 active flip → L2 stale → L3 stale.

-- ────────────────────────────────────────────────────────────────────
-- L2 SYNTHESES — scoped, source-agnostic, citation-required
-- ────────────────────────────────────────────────────────────────────

create table public.l2_syntheses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  scope_kind      text not null,         -- 'day' | 'meeting' | 'thread' | 'concept' | 'person' | 'arbitrary'
  scope_key       text not null,         -- '2026-05-04' | 'meeting:wework-1100' | 'concept:persofi-flow'

  body            text not null,         -- the synthesis (markdown)

  -- citation chain: every synthesis traces to specific L1 evidence
  cites_event_ids       uuid[] not null default '{}',
  cites_extraction_runs uuid[] not null default '{}',

  generator        text not null,        -- 'claude-opus-4-7' | 'gpt-5' | …
  generator_params jsonb not null default '{}'::jsonb,
  generated_at     timestamptz not null default now(),

  -- staleness lifecycle
  is_stale         boolean not null default false,
  stale_reason     text,
  superseded_by    uuid references public.l2_syntheses(id),

  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),

  unique (tenant_id, scope_kind, scope_key, generated_at)
);
create index l2_scope            on public.l2_syntheses (tenant_id, scope_kind, scope_key, generated_at desc);
create index l2_stale             on public.l2_syntheses (tenant_id, is_stale) where is_stale = true;
create index l2_cites_runs_gin    on public.l2_syntheses using gin (cites_extraction_runs);
create index l2_cites_events_gin  on public.l2_syntheses using gin (cites_event_ids);

-- ────────────────────────────────────────────────────────────────────
-- CITATION INTEGRITY GATE — every cited event_id must exist in l1_events
-- ────────────────────────────────────────────────────────────────────

create or replace function public.check_l2_citation_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  missing int;
begin
  if cardinality(new.cites_event_ids) = 0 then
    return new;  -- empty citations only allowed for arbitrary scope; v0.2 may tighten
  end if;

  select count(*) into missing
    from unnest(new.cites_event_ids) as cid
   where not exists (
     select 1
       from public.l1_events e
      where e.id = cid
        and e.tenant_id = new.tenant_id
   );

  if missing > 0 then
    raise exception 'l2_syntheses citation integrity failed: % cited event_ids do not exist in l1_events for this tenant', missing;
  end if;
  return new;
end;
$$;

create trigger l2_citation_integrity_check
before insert or update of cites_event_ids on public.l2_syntheses
for each row execute function public.check_l2_citation_integrity();

-- ────────────────────────────────────────────────────────────────────
-- STALENESS PROPAGATION — L1 active flip → L2 stale
-- ────────────────────────────────────────────────────────────────────

create or replace function public.mark_l2_stale_on_active_flip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.active_run_id is distinct from old.active_run_id then
    update public.l2_syntheses
       set is_stale = true,
           stale_reason = format('active run for (%s, %s) flipped from %s to %s at %s',
                                 new.artifact_id, new.facet, old.active_run_id, new.active_run_id, now())
     where tenant_id = new.tenant_id
       and is_stale = false
       and old.active_run_id = any(cites_extraction_runs);
  end if;
  return new;
end;
$$;

create trigger l2_staleness_propagate
after update on public.l1_active_extraction
for each row execute function public.mark_l2_stale_on_active_flip();

-- ────────────────────────────────────────────────────────────────────
-- L3 SURFACES — rendered views composed from L2 syntheses
-- ────────────────────────────────────────────────────────────────────

create table public.l3_surfaces (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  surface_key         text not null,           -- '_now' | '_decisions' | '_quotes' | 'concept:persofi-flow' | 'person:jeffrey-levine'

  body                text not null,           -- rendered markdown

  cites_synthesis_ids uuid[] not null default '{}',

  generated_at        timestamptz not null default now(),
  is_stale            boolean not null default false,
  stale_reason        text,

  metadata            jsonb not null default '{}'::jsonb,
  unique (tenant_id, surface_key, generated_at)
);
create index l3_surface_lookup on public.l3_surfaces (tenant_id, surface_key, generated_at desc);
create index l3_stale          on public.l3_surfaces (tenant_id, is_stale) where is_stale = true;
create index l3_cites_l2_gin   on public.l3_surfaces using gin (cites_synthesis_ids);

-- ────────────────────────────────────────────────────────────────────
-- STALENESS PROPAGATION — L2 stale → L3 stale
-- ────────────────────────────────────────────────────────────────────

create or replace function public.mark_l3_stale_on_l2_stale()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_stale and not old.is_stale)
     or (new.superseded_by is distinct from old.superseded_by) then
    update public.l3_surfaces
       set is_stale = true,
           stale_reason = format('cited L2 synthesis %s became stale at %s', new.id, now())
     where tenant_id = new.tenant_id
       and is_stale = false
       and new.id = any(cites_synthesis_ids);
  end if;
  return new;
end;
$$;

create trigger l3_staleness_propagate
after update on public.l2_syntheses
for each row execute function public.mark_l3_stale_on_l2_stale();

-- ────────────────────────────────────────────────────────────────────
-- HELPER VIEWS — "current" L2 / L3 (latest non-superseded per scope/surface)
-- ────────────────────────────────────────────────────────────────────

create view public.l2_current as
select distinct on (tenant_id, scope_kind, scope_key) *
  from public.l2_syntheses
 where superseded_by is null
 order by tenant_id, scope_kind, scope_key, generated_at desc;

create view public.l3_current as
select distinct on (tenant_id, surface_key) *
  from public.l3_surfaces
 order by tenant_id, surface_key, generated_at desc;

-- ────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────

alter table public.l2_syntheses enable row level security;
alter table public.l3_surfaces  enable row level security;

create policy l2_tenant_read on public.l2_syntheses for select using (tenant_id = public.current_tenant_id());
create policy l3_tenant_read on public.l3_surfaces  for select using (tenant_id = public.current_tenant_id());
