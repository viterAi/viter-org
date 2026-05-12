-- genUI kind grouping — global metadata table that tells the UI which payload
-- field to group `genui_l2` rows on for each service `kind`. Populated by
-- `ensureKindGrouping()` (AI inference + heuristic fallback) and editable from
-- the Corn-jobs admin panel.

create table if not exists public.genui_kind_grouping (
  kind            text  primary key,
  group_field     text  not null,
  group_label     text  not null,
  timestamp_field text,
  display_regex   text,
  confidence      text  not null default 'ai'
                  check (confidence in ('seed','ai','heuristic','admin')),
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table  public.genui_kind_grouping is 'Per-service-kind config for sidebar virtual sub-sources (Gmail→senders, WhatsApp→chats, …).';
comment on column public.genui_kind_grouping.kind is 'matches public.genui_channels.source';
comment on column public.genui_kind_grouping.group_field is 'genui_l2.payload jsonb field used for grouping (e.g. "from_email", "chat_slug").';
comment on column public.genui_kind_grouping.group_label is 'sidebar header label for groups of this kind ("Sender", "Chat", …).';
comment on column public.genui_kind_grouping.timestamp_field is 'optional payload field used to sort groups by newest activity.';
comment on column public.genui_kind_grouping.display_regex is 'optional regex with one capture group used to render a cleaner group label.';
comment on column public.genui_kind_grouping.confidence is 'seed (migration), ai (LLM), heuristic (fallback), admin (manual override).';
comment on column public.genui_kind_grouping.last_error is 'most recent LLM inference error; cleared once a successful inference replaces it.';

-- Seed rows for known service kinds. `from_email` (gmail/outlook) is a
-- normalised field that the mail-poll worker now writes alongside `from` so
-- SQL equality matches the same sender across "Name <addr>" variations.
insert into public.genui_kind_grouping
  (kind, group_field, group_label, timestamp_field, display_regex, confidence)
values
  ('gmail',    'from_email', 'Sender',     'date',       null, 'seed'),
  ('outlook',  'from_email', 'Sender',     'date',       null, 'seed'),
  ('whatsapp', 'chat_slug',  'Chat',       'ts_raw',     null, 'seed'),
  ('slack',    'channel',    'Channel',    'ts',         null, 'seed'),
  ('github',   'repo',       'Repository', 'created_at', null, 'seed'),
  ('clickup',  'list',       'List',       'created_at', null, 'seed')
on conflict (kind) do nothing;

-- bump updated_at on every update
create or replace function public.genui_kind_grouping_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists genui_kind_grouping_touch_updated_at_trg on public.genui_kind_grouping;
create trigger genui_kind_grouping_touch_updated_at_trg
  before update on public.genui_kind_grouping
  for each row execute function public.genui_kind_grouping_touch_updated_at();

-- RLS — global metadata: any authenticated user can read & write.
-- (v1: single tenant; once multi-tenant collisions become a thing, split into
-- a per-tenant override table.)
alter table public.genui_kind_grouping enable row level security;

drop policy if exists genui_kind_grouping_select on public.genui_kind_grouping;
create policy genui_kind_grouping_select on public.genui_kind_grouping
  for select to authenticated using (true);

drop policy if exists genui_kind_grouping_insert on public.genui_kind_grouping;
create policy genui_kind_grouping_insert on public.genui_kind_grouping
  for insert to authenticated with check (true);

drop policy if exists genui_kind_grouping_update on public.genui_kind_grouping;
create policy genui_kind_grouping_update on public.genui_kind_grouping
  for update to authenticated using (true) with check (true);

drop policy if exists genui_kind_grouping_delete on public.genui_kind_grouping;
create policy genui_kind_grouping_delete on public.genui_kind_grouping
  for delete to authenticated using (true);
