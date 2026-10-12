-- Promote an authenticated account to provider only when it explicitly enters
-- the provider onboarding flow (including the Google OAuth callback).
-- A new provider remains pending and cannot receive bookings until admin review.
create or replace function public.ensure_provider_profile()
returns public.provider_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.provider_profiles;
  current_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  insert into public.user_roles(user_id, role)
  values (auth.uid(), 'provider'::public.app_role)
  on conflict (user_id) do update
    set role = 'provider'::public.app_role
    where public.user_roles.role = 'customer'::public.app_role;

  select role into current_role
  from public.user_roles
  where user_id = auth.uid();

  if current_role is distinct from 'provider'::public.app_role then
    raise exception 'provider_role_conflict';
  end if;

  insert into public.provider_profiles(user_id, approval_status)
  values (auth.uid(), 'pending')
  on conflict (user_id) do nothing;

  select * into created
  from public.provider_profiles
  where user_id = auth.uid();

  return created;
end;
$$;

revoke all on function public.ensure_provider_profile() from public, anon;
grant execute on function public.ensure_provider_profile() to authenticated;
