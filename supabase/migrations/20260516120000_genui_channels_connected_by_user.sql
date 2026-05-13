-- Scope genUI channels (Corn jobs) per connected user within a tenant — not shared across all members.
-- Also: ingest job idempotency is per channel so the same GitHub delivery can enqueue one job per user/repo row.

-- ─── 1. Column + backfill ───────────────────────────────────────────────────

alter table public.genui_channels
  add column if not exists connected_by_user_id uuid references auth.users(id) on delete cascade;

update public.genui_channels gc
set connected_by_user_id = coalesce(
  gc.connected_by_user_id,
  (
    select tm.user_id
      from public.tenant_members tm
     where tm.tenant_id = gc.tenant_id
     order by case tm.role when 'admin' then 0 else 1 end, tm.created_at asc
     limit 1
  ),
  (
    select tm.user_id
      from public.tenant_memberships tm
     where tm.tenant_id = gc.tenant_id
     limit 1
  )
)
where gc.connected_by_user_id is null;

do $$
begin
  if exists (select 1 from public.genui_channels where connected_by_user_id is null) then
    raise exception 'genui_channels.connected_by_user_id backfill failed — add tenant_members(hips) rows or delete orphan channels';
  end if;
end $$;

alter table public.genui_channels alter column connected_by_user_id set not null;

comment on column public.genui_channels.connected_by_user_id is
  'Supabase auth user who created this ingest channel; RLS limits normal members to their own rows.';

-- ─── 2. Uniqueness: same external surface may exist once per user per tenant ─

alter table public.genui_channels
  drop constraint if exists genui_channels_tenant_id_source_external_key_key;

create unique index if not exists genui_channels_tenant_user_source_key
  on public.genui_channels (tenant_id, connected_by_user_id, source, external_key);

-- Keep lookup index useful for webhook resolution by tenant + source + key
create index if not exists genui_channels_tenant_source_key
  on public.genui_channels (tenant_id, source, external_key);

-- ─── 3. RLS — member sees own channels; tenant admins see all in tenant ─────

drop policy if exists genui_channels_member_read on public.genui_channels;
drop policy if exists genui_channels_member_insert on public.genui_channels;
drop policy if exists genui_channels_member_update on public.genui_channels;

create policy genui_channels_member_read on public.genui_channels
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      connected_by_user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  );

create policy genui_channels_member_insert on public.genui_channels
  for insert to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and connected_by_user_id = (select auth.uid())
  );

create policy genui_channels_member_update on public.genui_channels
  for update to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      connected_by_user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  )
  with check (
    public.is_tenant_member(tenant_id)
    and (
      connected_by_user_id = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  );

-- ─── 4. Ingest jobs — idempotency scoped per channel (multi-user same repo) ─

drop index if exists public.genui_ingest_jobs_idempotency;

create unique index if not exists genui_ingest_jobs_channel_idempotency
  on public.genui_ingest_jobs (genui_channel_id, idempotency_key)
  where idempotency_key is not null;
