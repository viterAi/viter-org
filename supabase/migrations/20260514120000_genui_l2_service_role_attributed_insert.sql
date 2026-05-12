-- Allow service_role INSERT when created_by is set and is a member of new.tenant_id
-- (mail cron / jobs use L0_SUPABASE_SERVICE_ROLE_KEY + GENUI_L2_ATTRIBUTED_USER_ID).

create or replace function public.genui_l2_enforce_created_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    elsif coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
      if new.created_by is null then
        raise exception 'genui_l2: service_role INSERT requires created_by (UUID of a tenant member)';
      end if;
      if not exists (
        select 1
          from public.tenant_members tm
         where tm.tenant_id = new.tenant_id
           and tm.user_id = new.created_by
      ) then
        raise exception 'genui_l2: created_by must be a member of tenant_id';
      end if;
    else
      raise exception 'genui_l2: INSERT requires a Supabase session (JWT) or service_role with attributed created_by';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.created_by is distinct from old.created_by then
      raise exception 'genui_l2: created_by is immutable';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.genui_l2_enforce_created_by() is
  'INSERT: JWT sets created_by from auth.uid(); service_role must supply created_by in row and user must be in tenant_members.';
