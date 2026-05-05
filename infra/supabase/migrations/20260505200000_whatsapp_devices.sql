-- 011 · whatsapp_devices — bridge between vita tenants and GOWA-managed WhatsApp linked-device sessions.
--
-- One row per (tenant, paired phone). Each row maps a GOWA `device_id` to a
-- vita `tenant_id` so the openrouter-style `whatsapp-webhook` Edge Function
-- can resolve incoming events back to the right tenant before inserting into
-- l0_artifacts / l1_events.
--
-- The status state machine:
--   pending          — POST /devices issued, QR not yet scanned
--   linked           — phone scanned QR, session active, messages flowing
--   re_pair_required — last_seen_at older than ~7 days; UI shows banner
--   disconnected     — websocket dropped; whatsmeow reconnect in progress
--   expired          — multi-device 14-day window elapsed without phone confirm
--   banned           — WhatsApp flagged the account; manual recovery
--
-- Re-pair semantics: status='re_pair_required' is a soft warning that drives
-- UI banners. A re-pair scan REPLACES the same row's auth state in GOWA but
-- keeps the same vita row → same channel_id → same l1_events history.

create table public.whatsapp_devices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,

  -- ─── GOWA identity ──────────────────────────────────────────────
  gowa_device_id  text not null,                        -- the id GOWA assigned us
  phone_number    text,                                 -- E.164 once linked, null while pending
  display_name    text,                                 -- 'Mordechai personal' | 'Persofi-CS-1'

  -- ─── Lifecycle state ────────────────────────────────────────────
  status          text not null default 'pending'
    check (status in ('pending','linked','disconnected','re_pair_required','expired','banned')),
  paired_at       timestamptz,                          -- first transition to 'linked'
  last_seen_at    timestamptz,                          -- last verified-connected event from GOWA
  re_pair_url     text,                                 -- transient QR URL when re-pair needed

  -- ─── Channel linkage ───────────────────────────────────────────
  -- Resolved on first inbound message — connects to the existing channels
  -- table (kind='whatsapp', identifier=<chat_slug>). Null while pending.
  channel_id      uuid references public.channels(id) on delete set null,

  -- ─── Diagnostics ────────────────────────────────────────────────
  last_error      text,
  banned_at       timestamptz,
  expires_at      timestamptz,                          -- predicted re-pair-required moment (paired_at + 7 days)

  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (tenant_id, gowa_device_id)
);
create index whatsapp_devices_tenant   on public.whatsapp_devices (tenant_id, status);
create index whatsapp_devices_status   on public.whatsapp_devices (status, last_seen_at);
create index whatsapp_devices_phone    on public.whatsapp_devices (tenant_id, phone_number) where phone_number is not null;
create index whatsapp_devices_expires  on public.whatsapp_devices (expires_at) where expires_at is not null;

-- Trigger to maintain updated_at + auto-compute expires_at on pair
create or replace function public.whatsapp_devices_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if (tg_op = 'UPDATE' and old.status <> 'linked' and new.status = 'linked') then
    new.paired_at := coalesce(new.paired_at, now());
    new.expires_at := coalesce(new.paired_at, now()) + interval '13 days';
    new.last_seen_at := coalesce(new.last_seen_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_devices_touch_t on public.whatsapp_devices;
create trigger whatsapp_devices_touch_t
  before update on public.whatsapp_devices
  for each row execute function public.whatsapp_devices_touch();

-- ─── RLS — tenant-scoped ───────────────────────────────────────────
alter table public.whatsapp_devices enable row level security;

drop policy if exists whatsapp_devices_tenant_read on public.whatsapp_devices;
create policy whatsapp_devices_tenant_read
  on public.whatsapp_devices
  for select
  using (tenant_id = public.current_tenant_id());

-- Service role bypasses RLS; this is what the Edge Function + trigger.dev uses.
-- Tenants cannot insert/update/delete devices via the anon key — pair/unlink
-- flows go through trigger.dev tasks running as service_role.

-- ─── Health view ──────────────────────────────────────────────────
-- Single SQL query that answers "is the WhatsApp layer healthy?"
-- Health score decays as: re-pair window approaches (≤3 days = -30),
-- last_seen_at age (>5 min = -20, >1 hr = -50), status not 'linked' (-50).
create or replace view public.whatsapp_device_health as
select
  d.id,
  d.tenant_id,
  d.gowa_device_id,
  d.phone_number,
  d.display_name,
  d.status,
  d.last_seen_at,
  d.expires_at,
  case
    when d.expires_at is not null
      then greatest(0, extract(epoch from (d.expires_at - now()))::int / 86400)
    else null
  end as days_until_re_pair,
  greatest(0,
    100
    - case when d.status = 'linked' then 0 else 50 end
    - case
        when d.last_seen_at is null then 30
        when d.last_seen_at < now() - interval '1 hour' then 50
        when d.last_seen_at < now() - interval '5 minutes' then 20
        else 0
      end
    - case
        when d.expires_at is null then 0
        when d.expires_at < now() then 50
        when d.expires_at < now() + interval '1 day'  then 30
        when d.expires_at < now() + interval '3 days' then 10
        else 0
      end
  ) as health_score,
  d.banned_at,
  d.last_error,
  (
    select max(e.event_at)
      from public.l1_events e
     where e.channel_id = d.channel_id
       and e.tenant_id = d.tenant_id
  ) as latest_message_at
from public.whatsapp_devices d;

-- ─── Convenience: which devices need attention? ─────────────────
create or replace view public.whatsapp_devices_needing_attention as
select * from public.whatsapp_device_health
 where health_score < 70
    or status in ('disconnected','re_pair_required','expired','banned')
 order by health_score asc, last_seen_at asc nulls first;

comment on table public.whatsapp_devices is
  '011 · GOWA device <-> tenant bridge. One row per paired phone. Status state machine drives UI re-pair banners + alerts.';
comment on view public.whatsapp_device_health is
  '011 · Per-device health roll-up. Used by trigger.dev wa-health-check task and by apps/web settings page.';
