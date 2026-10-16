create or replace function public.admin_create_manual_booking(
  p_customer_id uuid,
  p_service_id uuid,
  p_provider_id uuid default null,
  p_city text default '',
  p_district text default '',
  p_address_text text default '',
  p_issue_description text default '',
  p_urgency text default 'normal',
  p_scheduled_date date default null,
  p_scheduled_slot text default null,
  p_price numeric default null
) returns public.bookings
language plpgsql security definer set search_path=public as $$
declare created public.bookings; target_status public.booking_status;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if not exists(select 1 from public.user_roles where user_id=p_customer_id and role='customer') then raise exception 'customer_not_found'; end if;
  if not exists(select 1 from public.services where id=p_service_id and is_active) then raise exception 'service_not_found'; end if;
  if p_provider_id is not null and not exists(select 1 from public.provider_profiles where user_id=p_provider_id and approval_status='approved') then raise exception 'provider_not_approved_or_inactive'; end if;
  target_status := case when p_provider_id is null then 'pending'::public.booking_status else 'assigned'::public.booking_status end;
  insert into public.bookings(customer_id,service_id,provider_id,city,district,address_text,issue_description,urgency,scheduled_date,scheduled_slot,status,price_snapshot,location_source)
  values(p_customer_id,p_service_id,p_provider_id,left(trim(p_city),120),left(trim(p_district),160),left(trim(p_address_text),500),left(trim(p_issue_description),2000),case when p_urgency='urgent' then 'urgent' else 'normal' end,p_scheduled_date,left(trim(coalesce(p_scheduled_slot,'')),80),target_status,p_price,'none') returning * into created;
  insert into public.booking_status_history(booking_id,to_status,changed_by,note) values(created.id,target_status,auth.uid(),'أنشأته الإدارة نيابة عن العميل.');
  if p_provider_id is not null then insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_provider_id,'طلب جديد من الإدارة','تم إسناد طلب جديد لك مباشرة من لوحة الإدارة.','booking_assigned','/provider/work-queue'); end if;
  insert into public.notifications(user_id,title,body,notification_type,target_path) values(p_customer_id,'تم إنشاء طلبك','أنشأت الإدارة طلب خدمة بالنيابة عنك.','booking_created','/customer/orders');
  return created;
end; $$;
revoke all on function public.admin_create_manual_booking(uuid,uuid,uuid,text,text,text,text,text,date,text,numeric) from public,anon;
grant execute on function public.admin_create_manual_booking(uuid,uuid,uuid,text,text,text,text,text,date,text,numeric) to authenticated;
