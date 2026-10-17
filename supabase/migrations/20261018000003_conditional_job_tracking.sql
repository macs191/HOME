-- Per-booking customer consent and short-lived provider tracking points.
alter table public.bookings add column if not exists tracking_consent_at timestamptz;
alter table public.bookings add column if not exists tracking_revoked_at timestamptz;

create table if not exists public.booking_tracking_locations (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_meters numeric(10,2) check (accuracy_meters is null or (accuracy_meters >= 0 and accuracy_meters <= 10000)),
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists booking_tracking_locations_expiry_idx on public.booking_tracking_locations(expires_at);
alter table public.booking_tracking_locations enable row level security;
drop policy if exists "booking participants read active tracking" on public.booking_tracking_locations;
create policy "booking participants read active tracking" on public.booking_tracking_locations for select to authenticated using (
  expires_at > now() and exists (select 1 from public.bookings b where b.id = booking_id and (b.provider_id = auth.uid() or b.customer_id = auth.uid() or public.is_admin()) and b.tracking_consent_at is not null and b.tracking_revoked_at is null)
);

create or replace function public.customer_set_tracking_consent(p_booking_id uuid, p_consent boolean)
returns public.bookings language plpgsql security definer set search_path = public, pg_temp as $$
declare changed public.bookings;
begin
  update public.bookings set tracking_consent_at = case when p_consent then coalesce(tracking_consent_at, now()) else tracking_consent_at end,
    tracking_revoked_at = case when p_consent then null else now() end, updated_at = now()
  where id = p_booking_id and customer_id = auth.uid() and provider_id is not null
    and status in ('assigned','on_the_way','arrived','in_progress')
  returning * into changed;
  if changed.id is null then raise exception 'tracking_consent_not_allowed'; end if;
  if not p_consent then delete from public.booking_tracking_locations where booking_id = p_booking_id; end if;
  return changed;
end; $$;

create or replace function public.provider_update_booking_location(p_booking_id uuid, p_latitude numeric, p_longitude numeric, p_accuracy_meters numeric default null)
returns public.booking_tracking_locations language plpgsql security definer set search_path = public, pg_temp as $$
declare point public.booking_tracking_locations;
begin
  if auth.uid() is null or not public.has_role('provider'::public.app_role) then raise exception 'provider_account_required'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then raise exception 'invalid_location'; end if;
  insert into public.booking_tracking_locations(booking_id, provider_id, latitude, longitude, accuracy_meters, captured_at, expires_at)
  select b.id, b.provider_id, p_latitude, p_longitude, p_accuracy_meters, now(), now() + interval '2 minutes'
  from public.bookings b where b.id = p_booking_id and b.provider_id = auth.uid() and b.status in ('on_the_way','arrived','in_progress') and b.tracking_consent_at is not null and b.tracking_revoked_at is null
  on conflict (booking_id) do update set latitude = excluded.latitude, longitude = excluded.longitude, accuracy_meters = excluded.accuracy_meters, captured_at = excluded.captured_at, expires_at = excluded.expires_at
  returning * into point;
  if point.booking_id is null then raise exception 'tracking_not_active'; end if;
  return point;
end; $$;

revoke all on function public.customer_set_tracking_consent(uuid, boolean) from public, anon;
grant execute on function public.customer_set_tracking_consent(uuid, boolean) to authenticated;
revoke all on function public.provider_update_booking_location(uuid, numeric, numeric, numeric) from public, anon;
grant execute on function public.provider_update_booking_location(uuid, numeric, numeric, numeric) to authenticated;
grant select on public.booking_tracking_locations to authenticated;
