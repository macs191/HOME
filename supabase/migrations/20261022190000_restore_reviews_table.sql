create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.profiles(id),
  provider_id uuid not null references public.provider_profiles(user_id),
  quality smallint not null check (quality between 1 and 5),
  punctuality smallint not null check (punctuality between 1 and 5),
  conduct smallint not null check (conduct between 1 and 5),
  value smallint not null check (value between 1 and 5),
  comment text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;
drop policy if exists reviews_select_participant on public.reviews;
create policy reviews_select_participant on public.reviews for select to authenticated using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
drop policy if exists reviews_insert_customer_completed on public.reviews;
create policy reviews_insert_customer_completed on public.reviews for insert to authenticated with check (customer_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid() and b.status = 'completed'));
revoke all on table public.reviews from anon;
grant select on table public.reviews to authenticated;
grant insert on table public.reviews to authenticated;
