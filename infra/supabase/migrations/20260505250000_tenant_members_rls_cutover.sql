-- 017 · PR B — RLS cut-over.
-- Replaces the temporary v01_anon_read_* policies with auth.uid()-based
-- tenant_members policies. Service-role still bypasses RLS, so webhook
-- ingest, composer writes, and page-level reads via service-role are
-- unchanged.
--
-- Already applied to vita prod (dkccadwohifcqcdzhhnu) via MCP.

create table if not exists public.tenant_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

alter table public.tenant_members enable row level security;

drop policy if exists tenant_members_self_read on public.tenant_members;
create policy tenant_members_self_read on public.tenant_members
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.is_tenant_member(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tenant_members
     where tenant_id = _tenant_id
       and user_id = auth.uid()
  );
$$;

grant execute on function public.is_tenant_member(uuid) to authenticated;

-- Auto-bind known emails to the viter tenant on signup.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _viter_id uuid;
begin
  select id into _viter_id from public.tenants where slug = 'viter' limit 1;
  if _viter_id is null then return new; end if;

  if lower(new.email) = any (array[
    'mordechaipotash@gmail.com',
    'shaul@viter.ai'
  ]) then
    insert into public.tenant_members (user_id, tenant_id, role)
    values (new.id, _viter_id, 'admin')
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Bind Mordechai's existing auth user (signed up before the trigger).
insert into public.tenant_members (user_id, tenant_id, role)
values (
  '65e5d2cf-c97b-4c83-85ed-93afd76b7196',
  'bffb2f3b-03e8-45f4-bb76-7f2dfb023ffa',
  'admin'
)
on conflict do nothing;

-- channels
drop policy if exists v01_anon_read_channels on public.channels;
drop policy if exists channels_member_read on public.channels;
create policy channels_member_read on public.channels
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- l1_events
drop policy if exists v01_anon_read_l1_events on public.l1_events;
drop policy if exists l1_events_member_read on public.l1_events;
create policy l1_events_member_read on public.l1_events
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- whatsapp_devices
drop policy if exists v01_anon_read_whatsapp_devices on public.whatsapp_devices;
drop policy if exists whatsapp_devices_member_read on public.whatsapp_devices;
create policy whatsapp_devices_member_read on public.whatsapp_devices
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

-- l0_artifacts
drop policy if exists l0_artifacts_member_read on public.l0_artifacts;
create policy l0_artifacts_member_read on public.l0_artifacts
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

drop policy if exists tenants_member_read on public.tenants;
create policy tenants_member_read on public.tenants
  for select to authenticated
  using (public.is_tenant_member(id));

drop policy if exists principals_member_read on public.principals;
create policy principals_member_read on public.principals
  for select to authenticated
  using (true);
