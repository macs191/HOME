-- Provider weekly working hours and planned time off.
-- All rows are private to their provider; assignment logic can consume them later.
create table if not exists public.provider_weekly_availability (
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (provider_id, weekday),
  check (end_time > start_time)
);

create table if not exists public.provider_time_off (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (char_length(coalesce(reason, '')) <= 240)
);

create index if not exists provider_time_off_provider_dates_idx
  on public.provider_time_off(provider_id, starts_on, ends_on);

alter table public.provider_weekly_availability enable row level security;
alter table public.provider_time_off enable row level security;

drop policy if exists "providers manage own weekly availability" on public.provider_weekly_availability;
create policy "providers manage own weekly availability"
  on public.provider_weekly_availability for all
  using (provider_id = auth.uid())
  with check (provider_id = auth.uid());

drop policy if exists "providers manage own time off" on public.provider_time_off;
create policy "providers manage own time off"
  on public.provider_time_off for all
  using (provider_id = auth.uid())
  with check (provider_id = auth.uid());

grant select, insert, update, delete on public.provider_weekly_availability to authenticated;
grant select, insert, update, delete on public.provider_time_off to authenticated;
