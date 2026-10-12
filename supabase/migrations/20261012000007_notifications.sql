-- The customer dashboard reads this table, but it was absent from the live schema.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  notification_type text not null,
  target_path text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_created_idx
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.notifications from anon;
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
