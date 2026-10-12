-- Provider onboarding documents and restricted admin account management.
-- All uploaded documents remain private; never expose identity images by public URL.

alter table public.provider_profiles
  add column if not exists years_experience integer check (years_experience is null or years_experience >= 0),
  add column if not exists service_description text,
  add column if not exists onboarding_completed boolean not null default false;

alter table public.provider_documents
  drop constraint if exists provider_documents_document_type_check;
alter table public.provider_documents
  add constraint provider_documents_document_type_check
  check (document_type in ('national_id','identity_front','identity_back','cv','license','certificate'));

alter table public.provider_documents
  add column if not exists is_current boolean not null default true;

with ranked as (
  select id, row_number() over (partition by provider_id, document_type order by created_at desc, id desc) as rn
  from public.provider_documents
)
update public.provider_documents d
set is_current = (ranked.rn = 1)
from ranked
where d.id = ranked.id;

create unique index if not exists provider_documents_one_current_type_idx
  on public.provider_documents(provider_id, document_type) where is_current;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'provider-cvs', 'provider-cvs', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- CV objects: owner can upload/replace/read only their own files; administrators can read for review.
drop policy if exists "provider CV upload own" on storage.objects;
create policy "provider CV upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'provider-cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "provider CV read own or admin" on storage.objects;
create policy "provider CV read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'provider-cvs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "provider CV replace own" on storage.objects;
create policy "provider CV replace own" on storage.objects for update to authenticated
  using (bucket_id = 'provider-cvs' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'provider-cvs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "provider CV delete own or admin" on storage.objects;
create policy "provider CV delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'provider-cvs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- Keep the legacy identity bucket private and image-only; administrators retain read access.
update storage.buckets
set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg','image/png']::text[]
where id = 'identity-documents';

-- Submit profile, multi-service specialties and document pointers atomically.
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
begin
  if v_provider_id is null or not public.has_role('provider'::public.app_role) then
    raise exception 'provider_required';
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

-- The account directory returns email from auth.users only to an authenticated admin.
create or replace function public.admin_list_accounts(p_search text default null, p_role text default 'all')
returns table(
  user_id uuid,
  email text,
  role text,
  full_name text,
  phone text,
  city text,
  is_active boolean,
  created_at timestamptz,
  years_experience integer,
  approval_status text,
  service_description text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if coalesce(p_role,'all') not in ('all','customer','provider') then raise exception 'invalid_role_filter'; end if;
  return query
  select p.id, u.email::text, ur.role::text, p.full_name, p.phone, p.city, p.is_active, p.created_at,
         pp.years_experience, pp.approval_status, coalesce(pp.service_description, pp.professional_bio)
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join auth.users u on u.id = p.id
  left join public.provider_profiles pp on pp.user_id = p.id
  where ur.role in ('customer'::public.app_role, 'provider'::public.app_role)
    and (p_role = 'all' or ur.role::text = p_role)
    and (nullif(trim(p_search),'') is null or p.full_name ilike '%' || trim(p_search) || '%'
      or coalesce(p.phone,'') ilike '%' || trim(p_search) || '%'
      or coalesce(u.email,'') ilike '%' || trim(p_search) || '%')
  order by p.created_at desc
  limit 1000;
end;
$$;

create or replace function public.admin_update_account(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_city text,
  p_years_experience integer default null,
  p_service_description text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target_role public.app_role;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_full_name is null or length(trim(p_full_name)) < 2 or length(trim(p_full_name)) > 160 then raise exception 'invalid_full_name'; end if;
  if p_phone is not null and length(trim(p_phone)) > 32 then raise exception 'invalid_phone'; end if;
  if p_city is not null and length(trim(p_city)) > 120 then raise exception 'invalid_city'; end if;
  select role into target_role from public.user_roles where user_id = p_user_id;
  if target_role is null or target_role not in ('customer'::public.app_role,'provider'::public.app_role) then raise exception 'account_not_found'; end if;
  if target_role = 'provider'::public.app_role and p_years_experience is not null and (p_years_experience < 0 or p_years_experience > 70) then raise exception 'invalid_experience_years'; end if;

  update public.profiles
  set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone,'')),''), city = nullif(trim(coalesce(p_city,'')),''), updated_at = now()
  where id = p_user_id;

  if target_role = 'provider'::public.app_role then
    update public.provider_profiles
    set years_experience = coalesce(p_years_experience, years_experience),
        service_description = coalesce(nullif(trim(p_service_description),''), service_description),
        professional_bio = coalesce(nullif(trim(p_service_description),''), professional_bio),
        updated_at = now()
    where user_id = p_user_id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'admin_account_updated', 'account', p_user_id::text,
          jsonb_build_object('role',target_role::text,'fields',array['full_name','phone','city']));
end;
$$;

revoke all on function public.admin_list_accounts(text,text) from public, anon;
grant execute on function public.admin_list_accounts(text,text) to authenticated;
revoke all on function public.admin_update_account(uuid,text,text,text,integer,text) from public, anon;
grant execute on function public.admin_update_account(uuid,text,text,text,integer,text) to authenticated;


-- Persist the signup phone and the explicitly requested customer/provider role.
-- User metadata can never grant an administrative role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare requested_role public.app_role;
begin
  requested_role := case
    when new.raw_user_meta_data->>'requested_role' = 'provider' then 'provider'::public.app_role
    else 'customer'::public.app_role
  end;

  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'phone','')),'')
  ) on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, requested_role)
  on conflict (user_id) do nothing;

  if requested_role = 'provider'::public.app_role then
    insert into public.provider_profiles(user_id, approval_status)
    values (new.id, 'pending') on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
