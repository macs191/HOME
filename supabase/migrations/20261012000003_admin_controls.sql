-- HOME SERVICE / ضوابط الإدارة واعتماد الفنيين

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    phone = excluded.phone,
    updated_at = now();

  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case when new.raw_user_meta_data->>'requested_role' = 'provider'
      then 'provider'::public.app_role
      else 'customer'::public.app_role
    end
  )
  on conflict (user_id) do update set role = excluded.role
    where public.user_roles.role = 'customer';

  if new.raw_user_meta_data->>'requested_role' = 'provider' then
    insert into public.provider_profiles (user_id, professional_bio, approval_status)
    values (new.id, nullif(new.raw_user_meta_data->>'professional_bio', ''), 'pending')
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.review_provider_verification(
  p_provider_id uuid,
  p_status text,
  p_note text default null
)
returns public.provider_profiles
language plpgsql security definer set search_path = public as $$
declare changed public.provider_profiles;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'invalid_review_status'; end if;

  update public.provider_profiles
  set approval_status = p_status, updated_at = now()
  where user_id = p_provider_id
  returning * into changed;

  if changed.user_id is null then raise exception 'provider_not_found'; end if;

  update public.provider_documents
  set status = p_status,
      review_note = nullif(trim(p_note), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where provider_id = p_provider_id and status = 'pending';

  return changed;
end;
$$;

grant execute on function public.review_provider_verification(uuid, text, text) to authenticated;

create or replace function public.assign_booking(p_booking_id uuid, p_provider_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare changed public.bookings; previous_status public.booking_status;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if not exists (
    select 1 from public.provider_profiles
    where user_id = p_provider_id and approval_status = 'approved'
  ) then
    raise exception 'provider_not_approved';
  end if;

  select status into previous_status from public.bookings where id = p_booking_id for update;
  if previous_status is null then raise exception 'booking_not_found'; end if;

  update public.bookings
  set provider_id = p_provider_id, status = 'assigned', updated_at = now()
  where id = p_booking_id
  returning * into changed;

  insert into public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  values (p_booking_id, previous_status, 'assigned', auth.uid(), 'تم إسناد الطلب من لوحة الإدارة');
  return changed;
end;
$$;

grant execute on function public.assign_booking(uuid, uuid) to authenticated;


-- مزامنة الحسابات الفنية التي أنشئت قبل اعتماد دور provider تلقائيًا
update public.user_roles r
set role = 'provider'
from public.provider_profiles p
where p.user_id = r.user_id and r.role = 'customer';
