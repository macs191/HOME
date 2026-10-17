-- Keep existing providers without a saved schedule eligible for backwards compatibility.
-- Once a provider saves a weekly schedule, automatic dispatch respects disabled days and time off.
create or replace function public.auto_assign_nearest_provider(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings;
  v_provider uuid;
  v_distance numeric;
begin
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.id is null then raise exception 'booking_not_found'; end if;
  if v_booking.provider_id is not null or v_booking.status not in ('pending', 'quoted', 'accepted') then return v_booking; end if;
  with candidates as (
    select pp.user_id,
      case when v_booking.latitude is null or v_booking.longitude is null then
        case when lower(coalesce(pr.city, '')) = lower(coalesce(v_booking.city, '')) then 0 else 1 end
      else 6371 * 2 * asin(sqrt(
        power(sin(radians((pl.latitude - v_booking.latitude) / 2)), 2) +
        cos(radians(v_booking.latitude)) * cos(radians(pl.latitude)) *
        power(sin(radians((pl.longitude - v_booking.longitude) / 2)), 2)
      )) end as distance_km,
      pl.captured_at
    from public.provider_profiles pp
    join public.profiles pr on pr.id = pp.user_id and pr.is_active
    join public.provider_services ps on ps.provider_id = pp.user_id and ps.service_id = v_booking.service_id and ps.is_active
    join public.provider_locations pl on pl.provider_id = pp.user_id
    where pp.approval_status = 'approved'
      and pp.availability_status = 'available'
      and pp.location_sharing_enabled
      and pl.expires_at > now()
      and not exists (
        select 1 from public.provider_time_off off
        where off.provider_id = pp.user_id
          and v_booking.scheduled_date is not null
          and v_booking.scheduled_date between off.starts_on and off.ends_on
      )
      and (
        v_booking.scheduled_date is null
        or not exists (select 1 from public.provider_weekly_availability any_schedule where any_schedule.provider_id = pp.user_id)
        or exists (
          select 1 from public.provider_weekly_availability open_day
          where open_day.provider_id = pp.user_id
            and open_day.weekday = extract(dow from v_booking.scheduled_date)::smallint
            and open_day.is_enabled
        )
      )
      and not exists (
        select 1 from public.bookings busy
        where busy.provider_id = pp.user_id
          and busy.status in ('assigned', 'on_the_way', 'arrived', 'in_progress')
          and v_booking.scheduled_date is not null
          and busy.scheduled_date = v_booking.scheduled_date
          and coalesce(busy.scheduled_slot, '') = coalesce(v_booking.scheduled_slot, '')
      )
    order by distance_km asc, pl.captured_at desc
    limit 1
    for update of pp skip locked
  )
  select user_id, distance_km into v_provider, v_distance from candidates;
  if v_provider is null then return v_booking; end if;
  update public.bookings set provider_id = v_provider, status = 'assigned', updated_at = now()
  where id = p_booking_id returning * into v_booking;
  insert into public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  values (p_booking_id, 'pending', 'assigned', null, 'تمت المطابقة التلقائية مع أقرب فني متاح على بعد ' || round(v_distance, 1) || ' كم');
  insert into public.notifications(user_id, title, body, notification_type, target_path)
  values
    (v_provider, 'طلب جديد قريب منك', 'تم ترشيحك تلقائيًا لطلب مناسب لتخصصك وموقعك. افتح صندوق الطلبات لمراجعة التفاصيل.', 'booking_assigned', '/provider/work-queue'),
    (v_booking.customer_id, 'تم ترشيح فني لطلبك', 'تم العثور على أقرب فني متاح مناسب للخدمة، ويمكنك متابعة حالة الطلب من حسابك.', 'booking_assigned', '/customer/orders');
  return v_booking;
end;
$$;
