-- Fix the reserved CURRENT_ROLE keyword shadowing a PL/pgSQL variable.
-- PostgreSQL interpreted `current_role` as the session role (type name),
-- causing `operator does not exist: name = app_role` during provider login.
create or replace function public.ensure_provider_profile()
returns public.provider_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_created public.provider_profiles;
  v_existing_app_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  insert into public.user_roles(user_id, role)
  values (auth.uid(), 'provider'::public.app_role)
  on conflict (user_id) do update
    set role = 'provider'::public.app_role
    where public.user_roles.role = 'customer'::public.app_role;

  select ur.role into v_existing_app_role
  from public.user_roles as ur
  where ur.user_id = auth.uid();

  if v_existing_app_role is distinct from 'provider'::public.app_role then
    raise exception 'provider_role_conflict';
  end if;

  insert into public.provider_profiles(user_id, approval_status)
  values (auth.uid(), 'pending')
  on conflict (user_id) do nothing;

  select * into v_created
  from public.provider_profiles as pp
  where pp.user_id = auth.uid();

  return v_created;
end;
$$;

revoke all on function public.ensure_provider_profile() from public, anon;
grant execute on function public.ensure_provider_profile() to authenticated;
