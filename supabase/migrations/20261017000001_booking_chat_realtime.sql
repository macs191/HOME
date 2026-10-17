-- إنشاء جدول محادثة الطلب عند غيابه من بيئة الإنتاج.
create table if not exists public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  attachment_path text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_booking_idx on public.booking_messages(booking_id, created_at);
alter table public.booking_messages enable row level security;

drop policy if exists "participants read messages" on public.booking_messages;
drop policy if exists "participants send messages" on public.booking_messages;
drop policy if exists "admins read booking messages" on public.booking_messages;
drop policy if exists "admins send booking messages" on public.booking_messages;
drop policy if exists "participants mark booking messages read" on public.booking_messages;
create policy "participants read messages" on public.booking_messages for select using (sender_id = auth.uid() or public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid())));
create policy "participants send messages" on public.booking_messages for insert with check (sender_id = auth.uid() and (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid()))));
create policy "participants mark booking messages read" on public.booking_messages for update using (public.is_admin() or sender_id = auth.uid() or exists (select 1 from public.bookings b where b.id = booking_id and (b.customer_id = auth.uid() or b.provider_id = auth.uid()))) with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'booking_messages') then
    alter publication supabase_realtime add table public.booking_messages;
  end if;
end $$;
