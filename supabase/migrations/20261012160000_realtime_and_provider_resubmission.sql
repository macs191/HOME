-- Allow real-time in-app and Android system notifications for all authenticated roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- A provider may submit once; only a rejected application can be resubmitted.
create or replace function public.provider_submit_onboarding(
  p_years integer,
  p_description text,
  p_phone text,
  p_city text,
  p_identity_front_path text,
  p_identity_back_path text,
  p_cv_path text,
  p_service_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_provider_id uuid := auth.uid();
  selected_count integer;
  item record;
  v_onboarding_completed boolean := false;
  v_approval_status text;
begin
  if v_provider_id is null or not public.has_role('provider'::public.app_role) then
    raise exception 'provider_required';
  end if;
  select onboarding_completed, approval_status
    into v_onboarding_completed, v_approval_status
    from public.provider_profiles where user_id = v_provider_id for update;
  if coalesce(v_onboarding_completed, false) and coalesce(v_approval_status, 'pending') <> 'rejected' then
    raise exception 'provider_onboarding_already_submitted';
  end if;
  if p_years is null or p_years < 0 or p_years > 70 then
    raise exception 'invalid_experience_years';
  end if;
  if length(trim(coalesce(p_description,''))) < 10 or length(trim(p_description)) > 3000 then
    raise exception 'invalid_service_description';
  end if;
  if length(trim(coalesce(p_phone,''))) < 6 or length(trim(p_phone)) > 32 then
    raise exception 'invalid_phone';
  end if;
  if length(trim(coalesce(p_city,''))) < 2 or length(trim(p_city)) > 120 then
    raise exception 'invalid_city';
  end if;
  if coalesce(cardinality(p_service_ids),0) < 1 or cardinality(p_service_ids) > 50 then
    raise exception 'at_least_one_service_required';
  end if;
  if p_identity_front_path is null or p_identity_front_path !~ ('^' || v_provider_id::text || '/identity-front-[0-9a-f-]{36}$') then
    raise exception 'invalid_identity_front_path';
  end if;
  if p_identity_back_path is null or p_identity_back_path !~ ('^' || v_provider_id::text || '/identity-back-[0-9a-f-]{36}$') then
    raise exception 'invalid_identity_back_path';
  end if;
  if p_cv_path is not null and p_cv_path !~ ('^' || v_provider_id::text || '/cv-[0-9a-f-]{36}$') then
    raise exception 'invalid_cv_path';
  end if;
  select count(distinct s.id) into selected_count
  from public.services s
  where s.id = any(p_service_ids) and s.is_active;
  if selected_count <> cardinality(p_service_ids) then
    raise exception 'service_unavailable';
  end if;

  update public.profiles
  set phone = trim(p_phone), city = trim(p_city), updated_at = now()
  where id = v_provider_id;

  insert into public.provider_profiles(user_id, years_experience, service_description, professional_bio, national_id_last4, onboarding_completed, approval_status, updated_at)
  values (v_provider_id, p_years, trim(p_description), trim(p_description), null, true, 'pending', now())
  on conflict (user_id) do update set
    years_experience = excluded.years_experience,
    service_description = excluded.service_description,
    professional_bio = excluded.professional_bio,
    national_id_last4 = null,
    onboarding_completed = true,
    approval_status = 'pending',
    updated_at = now();

  delete from public.provider_services where provider_services.provider_id = v_provider_id;
  insert into public.provider_services(provider_id, service_id, is_active)
  select v_provider_id, s.id, true
  from public.services s where s.id = any(p_service_ids) and s.is_active;

  for item in select * from (values
    ('identity_front'::text, p_identity_front_path),
    ('identity_back'::text, p_identity_back_path),
    ('cv'::text, p_cv_path)
  ) as docs(document_type, storage_path)
  loop
    if item.storage_path is null then
      update public.provider_documents
      set is_current = false
      where public.provider_documents.provider_id = v_provider_id
        and public.provider_documents.document_type = item.document_type and is_current;
    else
      update public.provider_documents
      set is_current = false
      where public.provider_documents.provider_id = v_provider_id
        and public.provider_documents.document_type = item.document_type and is_current;
      insert into public.provider_documents(provider_id, document_type, storage_path, status, is_current)
      values (v_provider_id, item.document_type, item.storage_path, 'pending', true);
    end if;
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (v_provider_id, 'provider_onboarding_submitted', 'provider_profile', v_provider_id::text,
          jsonb_build_object('services_count', selected_count, 'has_cv', p_cv_path is not null));
end;
$$;

revoke all on function public.provider_submit_onboarding(integer,text,text,text,text,text,text,uuid[]) from public, anon;
grant execute on function public.provider_submit_onboarding(integer,text,text,text,text,text,text,uuid[]) to authenticated;
