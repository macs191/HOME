-- HOME SERVICE / تشغيل الفنيين والإدارة
alter table public.provider_profiles
  add column if not exists national_id_last4 text,
  add column if not exists years_experience integer check (years_experience is null or years_experience >= 0),
  add column if not exists service_description text,
  add column if not exists onboarding_completed boolean not null default false;

create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  document_type text not null default 'national_id' check (document_type in ('national_id','license','certificate')),
  storage_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(user_id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  entry_type text not null check (entry_type in ('earning','late_penalty','adjustment','payout')),
  amount numeric(12,2) not null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists provider_documents_provider_idx on public.provider_documents(provider_id, status, created_at desc);
create index if not exists provider_ledger_provider_idx on public.provider_ledger_entries(provider_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('identity-documents', 'identity-documents', false)
on conflict (id) do update set public = false;

alter table public.provider_documents enable row level security;
alter table public.provider_ledger_entries enable row level security;

drop policy if exists "providers read own verification documents" on public.provider_documents;
create policy "providers read own verification documents" on public.provider_documents for select using (provider_id = auth.uid() or public.is_admin());
drop policy if exists "providers create own verification documents" on public.provider_documents;
create policy "providers create own verification documents" on public.provider_documents for insert with check (provider_id = auth.uid());
drop policy if exists "admins manage verification documents" on public.provider_documents;
create policy "admins manage verification documents" on public.provider_documents for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "providers read own ledger" on public.provider_ledger_entries;
create policy "providers read own ledger" on public.provider_ledger_entries for select using (provider_id = auth.uid() or public.is_admin());
drop policy if exists "admins manage provider ledger" on public.provider_ledger_entries;
create policy "admins manage provider ledger" on public.provider_ledger_entries for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "provider identity upload" on storage.objects;
create policy "provider identity upload" on storage.objects for insert to authenticated with check (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "provider identity read" on storage.objects;
create policy "provider identity read" on storage.objects for select to authenticated using (bucket_id = 'identity-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "provider identity update" on storage.objects;
create policy "provider identity update" on storage.objects for update to authenticated using (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'identity-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.assign_booking(p_booking_id uuid, p_provider_id uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare changed public.bookings; previous_status public.booking_status;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  select status into previous_status from public.bookings where id = p_booking_id for update;
  if previous_status is null then raise exception 'booking_not_found'; end if;
  update public.bookings set provider_id = p_provider_id, status = 'assigned', updated_at = now() where id = p_booking_id returning * into changed;
  insert into public.booking_status_history(booking_id, from_status, to_status, changed_by, note)
  values (p_booking_id, previous_status, 'assigned', auth.uid(), 'تم إسناد الطلب من لوحة الإدارة');
  return changed;
end; $$;

create or replace function public.add_provider_ledger_entry(p_provider_id uuid, p_booking_id uuid, p_entry_type text, p_amount numeric, p_note text default null)
returns public.provider_ledger_entries language plpgsql security definer set search_path = public as $$
declare created public.provider_ledger_entries;
begin
  if not public.is_admin() then raise exception 'admin_required'; end if;
  if p_entry_type not in ('earning','late_penalty','adjustment','payout') then raise exception 'invalid_entry_type'; end if;
  if p_amount = 0 then raise exception 'invalid_amount'; end if;
  insert into public.provider_ledger_entries(provider_id, booking_id, entry_type, amount, note, created_by)
  values (p_provider_id, p_booking_id, p_entry_type, p_amount, nullif(trim(p_note), ''), auth.uid()) returning * into created;
  return created;
end; $$;

grant execute on function public.assign_booking(uuid, uuid) to authenticated;
grant execute on function public.add_provider_ledger_entry(uuid, uuid, text, numeric, text) to authenticated;
