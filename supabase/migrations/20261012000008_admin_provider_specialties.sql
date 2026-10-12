-- Let platform administrators update a provider's active service specialties safely.
create or replace function public.admin_set_provider_specialties(
  p_provider_id uuid,
  p_service_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role public.app_role;
  selected_count integer;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if coalesce(cardinality(p_service_ids), 0) < 1 or cardinality(p_service_ids) > 50 then
    raise exception 'at_least_one_service_required';
  end if;
  select role into target_role from public.user_roles where user_id = p_provider_id;
  if target_role is distinct from 'provider'::public.app_role then raise exception 'provider_not_found'; end if;
  select count(distinct s.id) into selected_count
  from public.services s where s.id = any(p_service_ids) and s.is_active;
  if selected_count <> cardinality(p_service_ids) then raise exception 'service_unavailable'; end if;

  delete from public.provider_services where provider_id = p_provider_id;
  insert into public.provider_services(provider_id, service_id, is_active)
  select p_provider_id, s.id, true from public.services s
  where s.id = any(p_service_ids) and s.is_active;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'admin_provider_specialties_updated', 'provider_profile', p_provider_id::text,
          jsonb_build_object('services_count', selected_count));
end;
$$;

revoke all on function public.admin_set_provider_specialties(uuid,uuid[]) from public, anon;
grant execute on function public.admin_set_provider_specialties(uuid,uuid[]) to authenticated;
