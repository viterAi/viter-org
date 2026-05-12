-- genUI L2 — per-row ownership (created_by), visibility (private | tenant), RLS, immutability trigger.
-- Coordinated with app: machine-user JWT for inserts (no service_role on genui_l2).

-- ─── helpers ────────────────────────────────────────────────────────────────

create or replace function public.is_tenant_admin(_tenant_id uuid)
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
       and role = 'admin'
  );
$$;

grant execute on function public.is_tenant_admin(uuid) to authenticated;

-- ─── columns ────────────────────────────────────────────────────────────────

alter table public.genui_l2
  add column if not exists created_by uuid references auth.users(id) on delete restrict;

alter table public.genui_l2
  add column if not exists visibility text;

update public.genui_l2 gl
set
  created_by = coalesce(
    gl.created_by,
    (
      select tm.user_id
        from public.tenant_members tm
       where tm.tenant_id = gl.tenant_id
       order by case tm.role when 'admin' then 0 else 1 end, tm.created_at asc
       limit 1
    )
  ),
  visibility = coalesce(gl.visibility, 'tenant')
where gl.created_by is null or gl.visibility is null;

do $$
begin
  if exists (select 1 from public.genui_l2 where created_by is null or visibility is null) then
    raise exception 'genui_l2 migration: backfill failed (missing tenant_members or empty tenants)';
  end if;
end $$;

alter table public.genui_l2 alter column visibility set default 'private';

alter table public.genui_l2 alter column visibility set not null;

alter table public.genui_l2
  drop constraint if exists genui_l2_visibility_check;

alter table public.genui_l2
  add constraint genui_l2_visibility_check check (visibility in ('private', 'tenant'));

alter table public.genui_l2 alter column created_by set not null;

create index if not exists genui_l2_tenant_creator_created
  on public.genui_l2 (tenant_id, created_by, created_at desc);

-- ─── created_by binding (no service_role: auth.uid() required) ─────────────

create or replace function public.genui_l2_enforce_created_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      raise exception 'genui_l2: INSERT requires a Supabase Auth session (use machine-user JWT, not service_role)';
    end if;
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by then
      raise exception 'genui_l2: created_by is immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists genui_l2_enforce_created_by_trg on public.genui_l2;

create trigger genui_l2_enforce_created_by_trg
  before insert or update on public.genui_l2
  for each row execute function public.genui_l2_enforce_created_by();

-- ─── RLS policies ───────────────────────────────────────────────────────────

drop policy if exists genui_l2_member_read on public.genui_l2;
drop policy if exists genui_l2_member_insert on public.genui_l2;
drop policy if exists genui_l2_member_update on public.genui_l2;
drop policy if exists genui_l2_member_delete on public.genui_l2;
drop policy if exists genui_l2_tenant_read on public.genui_l2;

create policy genui_l2_member_select on public.genui_l2
  for select to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and (
      visibility = 'tenant'
      or created_by = (select auth.uid())
      or public.is_tenant_admin(tenant_id)
    )
  );

create policy genui_l2_member_insert on public.genui_l2
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy genui_l2_member_update on public.genui_l2
  for update to authenticated
  using (public.is_tenant_member(tenant_id) and created_by = (select auth.uid()))
  with check (public.is_tenant_member(tenant_id) and created_by = (select auth.uid()));

create policy genui_l2_member_delete on public.genui_l2
  for delete to authenticated
  using (public.is_tenant_member(tenant_id) and created_by = (select auth.uid()));

comment on column public.genui_l2.created_by is 'Supabase auth user who owns the row; enforced by trigger (insert) and immutability (update).';
comment on column public.genui_l2.visibility is 'private: creator + tenant admins; tenant: all tenant members (read).';
