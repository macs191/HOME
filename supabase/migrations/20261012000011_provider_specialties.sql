create or replace function public.provider_get_specialties()
returns table(service_id uuid) language sql stable security definer set search_path = public as $$
  select ps.service_id from public.provider_services ps where ps.provider_id = auth.uid() and ps.is_active
$$;
revoke all on function public.provider_get_specialties() from public, anon;
grant execute on function public.provider_get_specialties() to authenticated;

create or replace function public.provider_set_specialties(p_service_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare saved_count integer;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'provider') then raise exception 'provider_role_required'; end if;
  if p_service_ids is null or cardinality(p_service_ids) = 0 then raise exception 'select_at_least_one_service'; end if;
  if exists (select 1 from unnest(p_service_ids) selected(id) left join public.services s on s.id = selected.id and s.is_active where s.id is null) then raise exception 'service_not_active'; end if;
  delete from public.provider_services where provider_id = auth.uid();
  insert into public.provider_services(provider_id, service_id, is_active)
  select auth.uid(), selected.id, true from (select distinct unnest(p_service_ids) as id) selected;
  get diagnostics saved_count = row_count;
  return saved_count;
end; $$;
revoke all on function public.provider_set_specialties(uuid[]) from public, anon;
grant execute on function public.provider_set_specialties(uuid[]) to authenticated;

create or replace function public.assign_booking(p_booking_id uuid, p_provider_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare changed public.bookings; old_status public.booking_status; requested_service_id uuid; service_name text;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if not exists (select 1 from public.provider_profiles where user_id = p_provider_id and approval_status = 'approved') then raise exception 'provider_not_approved'; end if;
  select b.status, b.service_id into old_status, requested_service_id from public.bookings b where b.id = p_booking_id and b.provider_id is null for update;
  if old_status is null or old_status not in ('pending','quoted','accepted') then raise exception 'booking_not_assignable'; end if;
  if not exists (select 1 from public.provider_services ps where ps.provider_id = p_provider_id and ps.service_id = requested_service_id and ps.is_active) then raise exception 'provider_not_qualified_for_service'; end if;
  select s.name_ar into service_name from public.services s where s.id = requested_service_id;
  update public.bookings set provider_id = p_provider_id, status = 'assigned', updated_at = now() where id = p_booking_id returning * into changed;
  insert into public.booking_status_history(booking_id,from_status,to_status,changed_by,note) values(p_booking_id,old_status,'assigned',auth.uid(),'تم إسناد الطلب من لوحة الإدارة');
  insert into public.notifications(user_id,title,body,notification_type,target_path) values
    (p_provider_id,'طلب جديد أُسند إليك','تم إسناد طلب '||coalesce(service_name,'خدمة منزلية')||' إليك. افتح لوحة الفني لمراجعة الموقع وبيانات التواصل.','booking_assigned','/provider#work-queue'),
    (changed.customer_id,'تم إسناد فني لطلبك','تم إسناد فني لطلبك رقم '||changed.booking_number||'.','booking_assigned','/customer#orders');
  return changed;
end; $$;
revoke all on function public.assign_booking(uuid,uuid) from public, anon;
grant execute on function public.assign_booking(uuid,uuid) to authenticated;
