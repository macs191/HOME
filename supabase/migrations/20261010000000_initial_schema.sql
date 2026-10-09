-- HOME SERVICE / Supabase PostgreSQL
-- طبّق هذا الملف على مشروع Supabase جديد بعد مراجعة سياسات الدولة والاحتفاظ بالبيانات.

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'provider', 'company', 'admin', 'sub_admin');
create type public.booking_status as enum ('draft', 'pending', 'quoted', 'accepted', 'assigned', 'on_the_way', 'arrived', 'in_progress', 'completed', 'cancelled', 'disputed');
create type public.payment_status as enum ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'settled');
create type public.location_source as enum ('none', 'gps', 'manual');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_url text,
  city text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role public.app_role not null default 'customer',
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  name text not null,
  description text,
  logo_url text,
  is_verified boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'technician' check (member_role in ('owner', 'manager', 'technician')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name_ar text not null,
  name_en text,
  description text,
  icon text,
  image_url text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id),
  slug text unique not null,
  name_ar text not null,
  name_en text,
  description text,
  pricing_type text not null default 'quote' check (pricing_type in ('fixed', 'quote', 'provider_quote')),
  base_price numeric(12,2) check (base_price is null or base_price >= 0),
  price_min numeric(12,2) check (price_min is null or price_min >= 0),
  price_max numeric(12,2) check (price_max is null or price_max >= price_min),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid references public.companies(id),
  professional_bio text,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'suspended')),
  availability_status text not null default 'unknown' check (availability_status in ('available', 'busy', 'offline', 'unknown')),
  rating_average numeric(3,2) not null default 0 check (rating_average between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  completed_jobs integer not null default 0 check (completed_jobs >= 0),
  default_commission_rate numeric(5,2),
  location_sharing_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_services (
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  price_min numeric(12,2),
  price_max numeric(12,2),
  is_active boolean not null default true,
  primary key (provider_id, service_id)
);

create table public.cities (
  id uuid primary key default gen_random_uuid(),
  name_ar text unique not null,
  is_active boolean not null default true
);

create table public.districts (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id) on delete cascade,
  name_ar text not null,
  is_active boolean not null default true,
  unique (city_id, name_ar)
);

create table public.provider_service_areas (
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  city_id uuid not null references public.cities(id) on delete cascade,
  district_id uuid references public.districts(id),
  primary key (provider_id, city_id, district_id)
);

create table public.provider_locations (
  provider_id uuid primary key references public.provider_profiles(user_id) on delete cascade,
  latitude numeric(9,6) not null check (latitude between -90 and 90),
  longitude numeric(9,6) not null check (longitude between -180 and 180),
  accuracy_meters numeric(10,2),
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  sharing_context text check (sharing_context in ('work', 'assigned_booking'))
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null default 'عنوان',
  city text not null,
  district text,
  address_text text not null,
  access_notes text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number bigint generated always as identity unique,
  customer_id uuid not null references public.profiles(id),
  service_id uuid not null references public.services(id),
  provider_id uuid references public.provider_profiles(user_id),
  city text not null,
  district text,
  address_text text not null,
  access_notes text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  location_source public.location_source not null default 'none',
  location_captured_at timestamptz,
  issue_description text not null,
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent')),
  scheduled_date date,
  scheduled_slot text,
  status public.booking_status not null default 'pending',
  price_snapshot numeric(12,2),
  commission_rate_snapshot numeric(5,2),
  commission_amount_snapshot numeric(12,2),
  provider_amount_snapshot numeric(12,2),
  payment_status public.payment_status not null default 'unpaid',
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_status public.booking_status,
  to_status public.booking_status not null,
  changed_by uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.booking_quotes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  provider_id uuid not null references public.provider_profiles(user_id),
  amount numeric(12,2) not null check (amount >= 0),
  visit_fee numeric(12,2) not null default 0 check (visit_fee >= 0),
  note text,
  expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default now()
);

create table public.booking_attachments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  storage_path text not null,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null,
  target_path text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  attachment_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique not null references public.bookings(id),
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

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  min_order_amount numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id),
  provider text not null default 'cash',
  external_reference text,
  amount numeric(12,2) not null check (amount >= 0),
  status public.payment_status not null default 'unpaid',
  idempotency_key text unique,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.has_role(required_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = required_role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role in ('admin', 'sub_admin'));
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', '')) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create index bookings_customer_idx on public.bookings(customer_id, created_at desc);
create index bookings_provider_idx on public.bookings(provider_id, status, scheduled_date);
create index bookings_status_idx on public.bookings(status, created_at desc);
create index services_category_idx on public.services(category_id, is_active, display_order);
create index provider_services_service_idx on public.provider_services(service_id, is_active);
create index provider_locations_fresh_idx on public.provider_locations(captured_at desc);
create index notifications_user_idx on public.notifications(user_id, is_read, created_at desc);
create index messages_booking_idx on public.booking_messages(booking_id, created_at);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.provider_profiles enable row level security;
alter table public.provider_services enable row level security;
alter table public.cities enable row level security;
alter table public.districts enable row level security;
alter table public.provider_service_areas enable row level security;
alter table public.provider_locations enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_status_history enable row level security;
alter table public.booking_quotes enable row level security;
alter table public.booking_attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.booking_messages enable row level security;
alter table public.reviews enable row level security;
alter table public.coupons enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;

create policy "public can read active categories" on public.service_categories for select using (is_active = true);
create policy "public can read active services" on public.services for select using (is_active = true);
create policy "public can read active cities" on public.cities for select using (is_active = true);
create policy "public can read active districts" on public.districts for select using (is_active = true);
create policy "users read own profile" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "users update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "users read own role" on public.user_roles for select using (user_id = auth.uid() or public.is_admin());
create policy "providers read own profile" on public.provider_profiles for select using (user_id = auth.uid() or public.is_admin());
create policy "providers update own editable profile" on public.provider_profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "customers manage own addresses" on public.customer_addresses for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy "customers read own bookings" on public.bookings for select using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
create policy "customers create own bookings" on public.bookings for insert with check (customer_id = auth.uid());
create policy "customers update own pending bookings" on public.bookings for update using ((customer_id = auth.uid() and status in ('draft','pending')) or provider_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
create policy "participants read booking history" on public.booking_status_history for select using (exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid() or public.is_admin())));
create policy "participants read quotes" on public.booking_quotes for select using (provider_id = auth.uid() or exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid()) or public.is_admin());
create policy "participants create quotes" on public.booking_quotes for insert with check (provider_id = auth.uid());
create policy "participants read notifications" on public.notifications for select using (user_id = auth.uid());
create policy "participants update notifications" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "participants read messages" on public.booking_messages for select using (sender_id = auth.uid() or exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid())));
create policy "participants send messages" on public.booking_messages for insert with check (sender_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid())));
create policy "customers read own reviews" on public.reviews for select using (customer_id = auth.uid() or provider_id = auth.uid() or public.is_admin());
create policy "customers review completed own booking" on public.reviews for insert with check (customer_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid() and b.status = 'completed'));
create policy "admins manage all operational data" on public.audit_logs for select using (public.is_admin());
create policy "admins manage companies" on public.companies for all using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());

-- Storage buckets تُنشأ من لوحة Supabase أو عبر Storage API، مع إبقاء المستندات خاصة.
-- مثال السياسات بعد إنشاء bucket باسم booking-attachments:
-- create policy "booking participants read attachments" on storage.objects for select using (bucket_id = 'booking-attachments' and auth.uid() is not null);
