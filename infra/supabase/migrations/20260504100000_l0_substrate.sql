-- 001 · L0 substrate
-- Foundational tables: tenants + memberships, principals (canonicalized actors),
-- channels (conversation surfaces), l0_source_types registry, l0_artifacts.
--
-- Refinements applied (per architecture review 2026-05-04):
--   #1 actor_id / channel_id are FK-typed (principals / channels), not loose text.
--   #6 timestamptz is microsecond-precision by default in pg.

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────
-- TENANTS + AUTH GLUE
-- ────────────────────────────────────────────────────────────────────

create table public.tenants (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,
  created_at   timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb
);

create table public.tenant_memberships (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- helper: tenant_id for the current authenticated user (first membership wins for v0.1)
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select tenant_id
    from public.tenant_memberships
   where user_id = auth.uid()
   limit 1;
$$;

-- ────────────────────────────────────────────────────────────────────
-- PRINCIPALS — canonicalized actors (humans, LLMs, systems, agents)
-- ────────────────────────────────────────────────────────────────────

create table public.principals (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  canonical_id text not null,                              -- e.g. 'jeffrey-levine'
  display_name text not null,
  kind         text not null default 'human' check (kind in ('human','llm','system','agent','unknown')),
  identifiers  jsonb not null default '[]'::jsonb,         -- ['jlevine@insperanto.com', '+44…', 'WA:🟢']
  metadata     jsonb not null default '{}'::jsonb,
  user_id      uuid references auth.users(id) on delete set null,  -- nullable: only when this principal IS an auth user
  created_at   timestamptz not null default now(),
  unique (tenant_id, canonical_id)
);
create index principals_user on public.principals (user_id) where user_id is not null;
create index principals_identifiers_gin on public.principals using gin (identifiers);

-- ────────────────────────────────────────────────────────────────────
-- CHANNELS — conversation/stream surfaces
-- ────────────────────────────────────────────────────────────────────

create table public.channels (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null,            -- 'meeting' | 'whatsapp' | 'claude-code' | 'cursor' | 'email' | 'vita-chat' | 'screenpipe-app'
  identifier   text not null,            -- 'wework-1100' | 'viter-internal' | 'viter-platform'
  display_name text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (tenant_id, kind, identifier)
);

-- ────────────────────────────────────────────────────────────────────
-- L0 SOURCE TYPES — open registry, not an enum
-- ────────────────────────────────────────────────────────────────────

create table public.l0_source_types (
  source_type    text primary key,
  description    text,
  default_facets text[] not null default '{}',  -- e.g. {'transcription','diarization'}
  metadata       jsonb not null default '{}'::jsonb
);

-- ────────────────────────────────────────────────────────────────────
-- L0 ARTIFACTS — immutable user-originated primary substrate
-- ────────────────────────────────────────────────────────────────────

create table public.l0_artifacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,

  source_type text not null references public.l0_source_types(source_type),
  source_uri  text not null,             -- file path / URI / message-id
  sha256      text not null,             -- content hash → immutability proof + dedup
  bytes       bigint,

  origin_at   timestamptz not null,      -- when content was created in the world
  captured_at timestamptz not null default now(),  -- when we ingested it

  storage_url text,                      -- bucket pointer when content > inline threshold
  inline_text text,                      -- small text-y L0 stays inline for cheap reads

  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  unique (tenant_id, sha256)
);
create index l0_artifacts_origin    on public.l0_artifacts (tenant_id, origin_at desc);
create index l0_artifacts_source    on public.l0_artifacts (tenant_id, source_type, origin_at desc);

-- ────────────────────────────────────────────────────────────────────
-- RLS — tenant-scoped reads via JWT membership
-- ────────────────────────────────────────────────────────────────────

alter table public.tenants              enable row level security;
alter table public.tenant_memberships   enable row level security;
alter table public.principals           enable row level security;
alter table public.channels             enable row level security;
alter table public.l0_artifacts         enable row level security;
-- l0_source_types is a global registry, no RLS

create policy tenants_member_read         on public.tenants              for select using (id = public.current_tenant_id());
create policy memberships_self_read       on public.tenant_memberships   for select using (user_id = auth.uid());
create policy principals_tenant_read      on public.principals           for select using (tenant_id = public.current_tenant_id());
create policy principals_tenant_write     on public.principals           for insert with check (tenant_id = public.current_tenant_id());
create policy channels_tenant_read        on public.channels             for select using (tenant_id = public.current_tenant_id());
create policy channels_tenant_write       on public.channels             for insert with check (tenant_id = public.current_tenant_id());
create policy l0_tenant_read              on public.l0_artifacts         for select using (tenant_id = public.current_tenant_id());
create policy l0_tenant_write             on public.l0_artifacts         for insert with check (tenant_id = public.current_tenant_id());

-- ────────────────────────────────────────────────────────────────────
-- SEED — initial L0 source types
-- ────────────────────────────────────────────────────────────────────

insert into public.l0_source_types (source_type, description, default_facets) values
  ('claude_code_jsonl', 'Claude Code session JSONL files',          array['turn_text','tool_calls']),
  ('cursor_jsonl',      'Cursor session JSONL files',               array['turn_text','tool_calls']),
  ('vita_chat',         'Vita in-app LLM chat',                     array['turn_text','tool_calls']),
  ('whatsapp_zip',      'WhatsApp chat export (zip)',               array['messages','voice_transcription']),
  ('whatsapp_message',  'WhatsApp single message (live ingest)',    array['messages','voice_transcription']),
  ('meeting_audio',     'Meeting audio recording',                  array['transcription','diarization','emotion','topic_segments']),
  ('screenpipe_audio',  'Screenpipe ambient audio',                 array['transcription','diarization']),
  ('screenpipe_ocr',    'Screenpipe screen OCR',                    array['ocr_text_blocks']),
  ('email_eml',         'Email message (RFC 5322)',                 array['messages']),
  ('pdf_upload',        'PDF document',                             array['ocr_pages','doc_chunks']),
  ('youtube_caption',   'YouTube video captions',                   array['transcription']),
  ('calendar_event',    'Calendar event (iCal/Google)',             array['events'])
on conflict (source_type) do nothing;
